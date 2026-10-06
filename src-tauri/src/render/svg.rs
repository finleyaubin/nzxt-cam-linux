//! SVG rasteriser for image widgets and logo previews: shapes, paths and gradients. `<text>` elements are not drawn.

use anyhow::Result;
use resvg::{tiny_skia as skia, usvg};
use std::path::Path;
use tiny_skia::{IntSize, Pixmap};

const MAX_SVG_BYTES: u64 = 8 * 1024 * 1024;

pub fn is_svg(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|e| e.eq_ignore_ascii_case("svg"))
}

/// Premultiplied pixmap of the SVG scaled to fit w×h, keeping its aspect ratio.
pub fn render_svg(path: &Path, w: u32, h: u32) -> Result<Pixmap> {
    let len = std::fs::metadata(path).map_err(|e| anyhow::anyhow!("Read svg {}: {e}", path.display()))?.len();
    if len > MAX_SVG_BYTES {
        anyhow::bail!("SVG {} is too large ({len} bytes)", path.display());
    }
    let data = std::fs::read(path).map_err(|e| anyhow::anyhow!("Read svg {}: {e}", path.display()))?;
    let tree = usvg::Tree::from_data(&data, &usvg::Options::default()).map_err(|e| anyhow::anyhow!("Parse svg {}: {e}", path.display()))?;
    let (iw, ih) = (tree.size().width(), tree.size().height());
    if !(iw > 0.0 && ih > 0.0) {
        anyhow::bail!("SVG {} has no size", path.display());
    }
    let scale = (w as f32 / iw).min(h as f32 / ih);
    let (tw, th) = (((iw * scale).round() as u32).max(1), ((ih * scale).round() as u32).max(1));
    let mut canvas = skia::Pixmap::new(tw, th).ok_or_else(|| anyhow::anyhow!("SVG {} has unusable dimensions", path.display()))?;
    resvg::render(&tree, skia::Transform::from_scale(tw as f32 / iw, th as f32 / ih), &mut canvas.as_mut());
    IntSize::from_wh(tw, th)
        .and_then(|size| Pixmap::from_vec(canvas.take(), size))
        .ok_or_else(|| anyhow::anyhow!("SVG {} has unusable dimensions", path.display()))
}
