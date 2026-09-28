//! Scene renderer — gauges (annular sector), bars (rounded rect), text.
//!
//! Mirrors render.ts from the Electron app. The pixel-perfect arc filling uses
//! the same per-pixel angle test the JS code does (simple and accurate; no
//! bezier approximation needed at 640×640).

use crate::render::fonts::{draw_text, draw_text_centered, font, measure};
use crate::types::{
    hex_to_rgb, resolve_text, BarElement, DisplayConfig, DisplayElement, GaugeElement, MetricId,
    TextElement, Temperatures, LCD_SIZE,
};
use anyhow::Result;
use crate::image_io;
use parking_lot::Mutex;
use std::sync::Arc;
use std::f32::consts::PI;
use tiny_skia::{Pixmap, PremultipliedColorU8};

// ============================================================================
// Public API
// ============================================================================

pub enum LcdFrame {
    /// Raw 640×640 RGBA, alpha 0 (firmware format).
    Rgba(Vec<u8>),
    /// Encoded GIF with the scene composited onto every frame.
    Gif(Vec<u8>),
}

enum Background {
    Still(Vec<u8>),
    Gif { bytes: Vec<u8>, first: Vec<u8> },
}

static BACKGROUND: Mutex<Option<(String, Arc<Background>)>> = Mutex::new(None);

fn load_background(path: &str) -> Result<Arc<Background>> {
    let mut cache = BACKGROUND.lock();
    if let Some((cached, bg)) = cache.as_ref() {
        if cached == path {
            return Ok(bg.clone());
        }
    }
    let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("Read background {path}: {e}"))?;
    let first = image_io::image_to_device_rgba(&bytes)?;
    let bg = Arc::new(if bytes.starts_with(b"GIF8") {
        Background::Gif { bytes, first }
    } else {
        Background::Still(first)
    });
    *cache = Some((path.to_string(), bg.clone()));
    Ok(bg)
}

pub fn has_gif_background(config: &DisplayConfig) -> bool {
    config
        .background_image
        .as_deref()
        .and_then(|p| load_background(p).ok())
        .is_some_and(|bg| matches!(*bg, Background::Gif { .. }))
}

/// Render a scene for the device: raw RGBA, or a GIF when the background is animated.
pub fn render_for_device(config: &DisplayConfig, temps: Temperatures) -> Result<LcdFrame> {
    let background = config.background_image.as_deref().map(load_background).transpose()?;
    match background.as_deref() {
        None => Ok(LcdFrame::Rgba(pixmap_to_device_rgba(&render_scene(config, temps, None)?))),
        Some(Background::Still(bg)) => Ok(LcdFrame::Rgba(pixmap_to_device_rgba(&render_scene(config, temps, Some(bg))?))),
        Some(Background::Gif { bytes, .. }) => {
            let gif = image_io::transcode_gif(bytes, |frame| match render_scene(config, temps, Some(&frame)) {
                Ok(pm) => pixmap_to_device_rgba(&pm),
                Err(_) => frame,
            })?;
            Ok(LcdFrame::Gif(gif))
        }
    }
}

/// Render a scene to a PNG byte stream (for the WYSIWYG preview). GIF backgrounds show their first frame.
pub fn render_preview_png(config: &DisplayConfig, temps: Temperatures) -> Result<Vec<u8>> {
    let background = config.background_image.as_deref().map(load_background).transpose()?;
    let bg = background.as_deref().map(|b| match b {
        Background::Still(rgba) | Background::Gif { first: rgba, .. } => rgba.as_slice(),
    });
    let pixmap = render_scene(config, temps, bg)?;
    let png = pixmap.encode_png().map_err(|e| anyhow::anyhow!("PNG encode: {e}"))?;
    Ok(png)
}

// ============================================================================
// Top-level rendering
// ============================================================================

fn render_scene(config: &DisplayConfig, temps: Temperatures, background: Option<&[u8]>) -> Result<Pixmap> {
    let mut pixmap = Pixmap::new(LCD_SIZE, LCD_SIZE)
        .ok_or_else(|| anyhow::anyhow!("Pixmap allocation failed"))?;

    match background {
        Some(rgba) => fill_image(&mut pixmap, rgba, config.background_dim.min(90)),
        None => {
            let (br, bg, bb) = hex_to_rgb(&config.background);
            fill_solid(&mut pixmap, br, bg, bb);
        }
    }

    // Ensure font is loaded once (lazy init in fonts.rs). Errors are surfaced
    // only when text elements try to draw — we don't abort on missing font.
    let _ = font();

    let decimals = config.decimals.min(2);
    for el in &config.elements {
        match el {
            DisplayElement::Gauge(g) => {
                if let Err(e) = draw_gauge(&mut pixmap, g, temps, decimals) {
                    log::warn!("gauge draw error: {e}");
                }
            }
            DisplayElement::Bar(b) => {
                if let Err(e) = draw_bar(&mut pixmap, b, temps, decimals) {
                    log::warn!("bar draw error: {e}");
                }
            }
            DisplayElement::Text(t) => {
                if let Err(e) = draw_text_element(&mut pixmap, t, temps, decimals) {
                    log::warn!("text draw error: {e}");
                }
            }
        }
    }
    Ok(pixmap)
}

fn pixmap_to_device_rgba(pm: &Pixmap) -> Vec<u8> {
    // tiny-skia stores premultiplied alpha; we want straight RGB with alpha=0.
    let src = pm.pixels();
    let mut out = vec![0u8; src.len() * 4];
    for (i, p) in src.iter().enumerate() {
        let a = p.alpha();
        let (r, g, b) = if a == 0 {
            (0, 0, 0)
        } else if a == 255 {
            (p.red(), p.green(), p.blue())
        } else {
            // Un-premultiply.
            let inv = 255.0 / a as f32;
            (
                (p.red() as f32 * inv).min(255.0) as u8,
                (p.green() as f32 * inv).min(255.0) as u8,
                (p.blue() as f32 * inv).min(255.0) as u8,
            )
        };
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = 0; // firmware requirement
    }
    out
}

// ============================================================================
// Primitives
// ============================================================================

fn fill_solid(pm: &mut Pixmap, r: u8, g: u8, b: u8) {
    let color = tiny_skia::Color::from_rgba8(r, g, b, 255);
    pm.fill(color);
}

/// Copy a straight-RGBA frame into the pixmap as opaque pixels, darkened by `dim` percent.
fn fill_image(pm: &mut Pixmap, rgba: &[u8], dim: u8) {
    let keep = (100 - dim as u16) as u16;
    for (dst, src) in pm.data_mut().chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        for c in 0..3 {
            dst[c] = (src[c] as u16 * keep / 100) as u8;
        }
        dst[3] = 255;
    }
}

fn put_pixel(pm: &mut Pixmap, x: i32, y: i32, r: u8, g: u8, b: u8) {
    let w = pm.width() as i32;
    let h = pm.height() as i32;
    if x < 0 || y < 0 || x >= w || y >= h {
        return;
    }
    let idx = (y * w + x) as usize;
    pm.pixels_mut()[idx] = PremultipliedColorU8::from_rgba(r, g, b, 255)
        .unwrap_or_else(|| PremultipliedColorU8::from_rgba(0, 0, 0, 255).unwrap());
}

/// Filled rounded rectangle. (x, y) is the top-left corner.
/// Point test for a w×h rectangle at the origin with corner radius `rad` (already clamped).
fn in_round_rect(fx: f32, fy: f32, w: f32, h: f32, rad: f32) -> bool {
    if fx < 0.0 || fy < 0.0 || fx > w || fy > h {
        return false;
    }
    let cx = fx.clamp(rad, w - rad);
    let cy = fy.clamp(rad, h - rad);
    (fx - cx).powi(2) + (fy - cy).powi(2) <= rad * rad
}

fn lerp_rgb(a: (u8, u8, u8), b: (u8, u8, u8), t: f32) -> (u8, u8, u8) {
    let mix = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t.clamp(0.0, 1.0)).round() as u8;
    (mix(a.0, b.0), mix(a.1, b.1), mix(a.2, b.2))
}

/// Filled rounded rectangle; `color` gets each pixel's absolute x so fills can carry a gradient.
fn fill_round_rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, radius: Option<f32>, color: impl Fn(f32) -> (u8, u8, u8)) {
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let rad = radius.unwrap_or(f32::MAX).clamp(0.0, h.min(w) / 2.0);
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    for yy in 0..h.ceil() as i32 {
        for xx in 0..w.ceil() as i32 {
            if in_round_rect(xx as f32, yy as f32, w, h, rad) {
                let (r, g, b) = color((x0 + xx) as f32);
                put_pixel(pm, x0 + xx, y0 + yy, r, g, b);
            }
        }
    }
}

// ============================================================================
// Gauge — annular sector with pixel test
// ============================================================================

fn metric_value(metric: MetricId, t: Temperatures) -> f64 {
    metric.value_from(t)
}

fn clamp01(v: f64) -> f64 {
    v.max(0.0).min(1.0)
}

fn draw_gauge(
    pm: &mut Pixmap,
    el: &GaugeElement,
    temps: Temperatures,
    decimals: u8,
) -> Result<()> {
    let v = metric_value(el.metric, temps);
    let frac = clamp01(v / el.max.max(0.0001)) as f32;
    let warn = v >= el.warn_at;
    let fill_rgb = hex_to_rgb(if warn { &el.warn_color } else { &el.color });
    let gradient_to = el.gradient_to.as_deref().filter(|_| !warn).map(hex_to_rgb);
    let track_rgb = hex_to_rgb(&el.track_color);

    let r_out = el.radius;
    let r_in = (el.radius - el.thickness).max(0.0);
    let start = (el.start_angle * PI) / 180.0;
    let sweep = el.sweep.max(1.0) * (PI / 180.0);
    // Rounded corners work in arc coordinates: along-arc distance × radial offset.
    let r_mid = (r_out + r_in) / 2.0;
    let band = r_out - r_in;
    let arc_len = sweep * r_mid;
    let rad = el.corner_radius.clamp(0.0, band / 2.0);
    let full_circle = el.sweep >= 360.0;

    let w = pm.width() as i32;
    let h = pm.height() as i32;
    let y0 = ((el.y - r_out).floor().max(0.0) as i32).min(h - 1);
    let y1 = ((el.y + r_out).ceil().max(0.0) as i32).min(h - 1);
    let x0 = ((el.x - r_out).floor().max(0.0) as i32).min(w - 1);
    let x1 = ((el.x + r_out).ceil().max(0.0) as i32).min(w - 1);

    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = x as f32 - el.x;
            let dy = y as f32 - el.y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < r_in || d > r_out {
                continue;
            }
            // atan2(dx, -dy): 0 at top, sweeping clockwise.
            let rel = (dx.atan2(-dy) - start).rem_euclid(PI * 2.0);
            if rel > sweep {
                continue;
            }
            let s = rel * r_mid;
            let u = d - r_in;
            let fill_len = arc_len * frac;
            let in_fill = frac > 0.0 && in_round_rect(s, u, fill_len.max(rad * 2.0), band, rad);
            let in_track = if full_circle { true } else { in_round_rect(s, u, arc_len, band, rad) };
            let (r, g, b) = if in_fill {
                gradient_to.map_or(fill_rgb, |to| lerp_rgb(fill_rgb, to, rel / sweep))
            } else if in_track {
                track_rgb
            } else {
                continue;
            };
            put_pixel(pm, x, y, r, g, b);
        }
    }

    // Centered label + value stack.
    let mut lines: Vec<(String, f32, (u8, u8, u8))> = Vec::new();
    if el.show_label && !el.label.is_empty() {
        let size = (el.value_size * 0.42).max(12.0);
        lines.push((el.label.clone(), size, (0x9a, 0xa0, 0xb4)));
    }
    if el.show_value {
        let txt = format!("{}{}", crate::types::format_metric(v, decimals), el.metric.unit());
        let color = if warn { hex_to_rgb(&el.warn_color) } else { hex_to_rgb(&el.color) };
        lines.push((txt, el.value_size, color));
    }
    if !lines.is_empty() {
        draw_centered_stack(pm, el.x, el.y, &lines)?;
    }
    Ok(())
}

fn draw_centered_stack(
    pm: &mut Pixmap,
    cx: f32,
    cy: f32,
    lines: &[(String, f32, (u8, u8, u8))],
) -> Result<()> {
    let gap = 4.0;
    let measured: Vec<_> = lines
        .iter()
        .map(|(s, sz, _)| measure(s, *sz).map(|m| (m, *sz)))
        .collect::<Result<Vec<_>>>()?;
    let total: f32 = measured.iter().map(|(m, _)| m.height).sum::<f32>()
        + gap * (lines.len().saturating_sub(1) as f32);
    let mut cur = cy - total / 2.0;
    for ((text, _, color), (m, sz)) in lines.iter().zip(measured.iter()) {
        let x = cx - m.width / 2.0;
        let y = cur;
        draw_text(pm, x, y, text, *sz, *color)?;
        cur += m.height + gap;
    }
    Ok(())
}

// ============================================================================
// Bar — rounded rect track + filled portion + label/value row above
// ============================================================================

fn draw_bar(pm: &mut Pixmap, el: &BarElement, temps: Temperatures, decimals: u8) -> Result<()> {
    let v = metric_value(el.metric, temps);
    let frac = clamp01(v / el.max.max(0.0001)) as f32;
    let warn = v >= el.warn_at;
    let fill_rgb = hex_to_rgb(if warn { &el.warn_color } else { &el.color });
    let gradient_to = el.gradient_to.as_deref().filter(|_| !warn).map(hex_to_rgb);
    let track_rgb = hex_to_rgb(&el.track_color);

    let left = el.x - el.width / 2.0;
    let top = el.y - el.height / 2.0;
    let fill = |px: f32| gradient_to.map_or(fill_rgb, |to| lerp_rgb(fill_rgb, to, (px - left) / el.width));
    let track = |_: f32| track_rgb;
    let radius = el.corner_radius;
    if el.segments > 0 {
        let n = el.segments as f32;
        let gap = (el.width / n * 0.15).clamp(2.0, 8.0);
        let seg_w = (el.width - gap * (n - 1.0)) / n;
        let lit = (frac * n).round() as u8;
        for i in 0..el.segments {
            let sx = left + i as f32 * (seg_w + gap);
            if i < lit {
                fill_round_rect(pm, sx, top, seg_w, el.height, radius, fill);
            } else {
                fill_round_rect(pm, sx, top, seg_w, el.height, radius, track);
            }
        }
    } else {
        fill_round_rect(pm, left, top, el.width, el.height, radius, track);
        if frac > 0.0 {
            let min_w = radius.unwrap_or(el.height / 2.0).min(el.height / 2.0) * 2.0; // keep the rounded end visible
            fill_round_rect(pm, left, top, (el.width * frac).max(min_w), el.height, radius, fill);
        }
    }

    // Label (left) + value (right) on a row above the bar.
    let row_y = top - el.value_size * 1.05;
    if el.show_label && !el.label.is_empty() {
        draw_text(pm, left, row_y, &el.label, el.value_size, (0x9a, 0xa0, 0xb4))?;
    }
    if el.show_value {
        let s = format!("{}{}", crate::types::format_metric(v, decimals), el.metric.unit());
        let m = measure(&s, el.value_size)?;
        let x = left + el.width - m.width;
        draw_text(pm, x, row_y, &s, el.value_size, (0xff, 0xff, 0xff))?;
    }
    Ok(())
}

// ============================================================================
// Text element
// ============================================================================

fn draw_text_element(
    pm: &mut Pixmap,
    el: &TextElement,
    temps: Temperatures,
    decimals: u8,
) -> Result<()> {
    let text = resolve_text(&el.text, temps, decimals);
    if text.is_empty() {
        return Ok(());
    }
    let m = measure(&text, el.size)?;
    use crate::types::TextAlign;
    let x = match el.align {
        TextAlign::Left => el.x,
        TextAlign::Center => el.x - m.width / 2.0,
        TextAlign::Right => el.x - m.width,
    };
    let y = el.y - m.height / 2.0;
    let color = hex_to_rgb(&el.color);
    draw_text(pm, x, y, &text, el.size, color)?;
    Ok(())
}

// ============================================================================
// Convenience: convert pixmap to base64 data URL (used by the preview command).
// ============================================================================

pub fn pixmap_to_data_url(pm: &Pixmap) -> Result<String> {
    let png = pm.encode_png().map_err(|e| anyhow::anyhow!("PNG encode: {e}"))?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[allow(dead_code)]
fn draw_centered(
    pm: &mut Pixmap,
    cx: f32,
    cy: f32,
    text: &str,
    size: f32,
    color: (u8, u8, u8),
) -> Result<()> {
    draw_text_centered(pm, cx, cy, text, size, color)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::gif::GifEncoder, Frame, Rgba, RgbaImage};

    fn config_with(path: &std::path::Path, dim: u8) -> DisplayConfig {
        DisplayConfig {
            background_image: Some(path.to_string_lossy().into_owned()),
            background_dim: dim,
            ..DisplayConfig::default()
        }
    }

    #[test]
    fn still_background_is_dimmed_rgba() {
        let path = std::env::temp_dir().join("nzxt-bg-test.png");
        RgbaImage::from_pixel(64, 64, Rgba([200, 100, 50, 255])).save(&path).unwrap();
        let LcdFrame::Rgba(rgba) = render_for_device(&config_with(&path, 50), Temperatures::default()).unwrap() else {
            panic!("expected rgba frame");
        };
        assert_eq!(rgba.len(), (LCD_SIZE * LCD_SIZE * 4) as usize);
        assert_eq!(&rgba[..3], &[100, 50, 25]);
    }

    #[test]
    fn segmented_square_bar_lights_half() {
        let bar = BarElement {
            id: "b".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, width: 400.0, height: 40.0, max: 100.0,
            color: "#ff0000".into(), track_color: "#0000ff".into(), warn_color: "#ff0000".into(), warn_at: 1000.0,
            show_value: false, show_label: false, label: String::new(), value_size: 20.0,
            segments: 10, corner_radius: Some(0.0), gradient_to: None,
        };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Bar(bar)], ..DisplayConfig::default() };
        let temps = Temperatures { cpu: 50.0, ..Temperatures::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, temps).unwrap() else { panic!("expected rgba") };
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [rgba[i], rgba[i + 1], rgba[i + 2]] };
        assert_eq!(px(120, 300), [255, 0, 0], "square corner of first segment is filled");
        assert_eq!(px(245, 320), [255, 0, 0], "third segment lit at 50%");
        assert_eq!(px(420, 320), [0, 0, 255], "eighth segment is track");
    }

    #[test]
    fn gauge_gradient_and_rounded_ends() {
        let gauge = GaugeElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 300.0, thickness: 40.0, max: 100.0,
            color: "#000000".into(), track_color: "#0000ff".into(), start_angle: 0.0, sweep: 180.0,
            warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: false, show_label: false, label: String::new(),
            value_size: 20.0, corner_radius: 20.0, gradient_to: Some("#ffffff".into()),
        };
        let cfg = DisplayConfig { background: "#101010".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
        let temps = Temperatures { cpu: 100.0, ..Temperatures::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, temps).unwrap() else { panic!("expected rgba") };
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [rgba[i], rgba[i + 1], rgba[i + 2]] };
        // Arc starts at 12 o'clock (x=320) and sweeps clockwise to 6 o'clock.
        assert_eq!(px(320, 21), [0x10, 0x10, 0x10], "outer corner at the start is rounded off");
        assert!(px(340, 40)[0] < 40, "fill starts near the first colour");
        assert!(px(600, 320)[0] > 100, "fill is mid-gradient at 3 o'clock");
    }

    #[test]
    fn negative_start_angle_draws_whole_gauge() {
        let gauge = GaugeElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 300.0, thickness: 40.0, max: 100.0,
            color: "#ff0000".into(), track_color: "#0000ff".into(), start_angle: -135.0, sweep: 270.0,
            warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: false, show_label: false, label: String::new(),
            value_size: 20.0, corner_radius: 0.0, gradient_to: None,
        };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures { cpu: 100.0, ..Temperatures::default() }).unwrap() else { panic!() };
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [rgba[i], rgba[i + 1], rgba[i + 2]] };
        assert_eq!(px(40, 320), [255, 0, 0], "9 o'clock is inside a -135°..135° gauge");
        assert_eq!(px(320, 40), [255, 0, 0], "12 o'clock");
        assert_eq!(px(320, 600), [0, 0, 0], "gap stays at the bottom");
    }

    #[test]
    fn gif_background_yields_gif() {
        let path = std::env::temp_dir().join("nzxt-bg-test.gif");
        {
            let mut enc = GifEncoder::new(std::fs::File::create(&path).unwrap());
            for shade in [0u8, 255] {
                enc.encode_frame(Frame::new(RgbaImage::from_pixel(32, 32, Rgba([shade, shade, shade, 255])))).unwrap();
            }
        }
        let cfg = config_with(&path, 0);
        assert!(has_gif_background(&cfg));
        let LcdFrame::Gif(gif) = render_for_device(&cfg, Temperatures::default()).unwrap() else {
            panic!("expected gif frame");
        };
        assert!(gif.starts_with(b"GIF8"));
    }
}
