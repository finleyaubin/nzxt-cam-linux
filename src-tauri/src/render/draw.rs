//! Drawing primitives and widgets (gauge, bar, graph, text, image) for the scene renderer.

use crate::render::fonts::{draw_text, draw_text_centered, measure};
use crate::types::{
    hex_to_rgb, resolve_text, BarElement, GaugeElement, GraphElement, ImageElement, MetricId, TextElement,
    TextPosition, Temperatures,
};
use ab_glyph::FontVec;
use anyhow::Result;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::f32::consts::PI;
use std::sync::Arc;
use tiny_skia::{IntSize, Pixmap, PixmapPaint, PremultipliedColorU8, Transform};

pub(super) fn fill_solid(pm: &mut Pixmap, r: u8, g: u8, b: u8) {
    let color = tiny_skia::Color::from_rgba8(r, g, b, 255);
    pm.fill(color);
}

/// Copy a straight-RGBA frame into the pixmap as opaque pixels, darkened by `dim` percent.
pub(super) fn fill_image(pm: &mut Pixmap, rgba: &[u8], dim: u8) {
    let keep = 100 - dim as u16;
    for (dst, src) in pm.data_mut().chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        for c in 0..3 {
            dst[c] = (src[c] as u16 * keep / 100) as u8;
        }
        dst[3] = 255;
    }
}

pub(super) fn put_pixel(pm: &mut Pixmap, x: i32, y: i32, r: u8, g: u8, b: u8) {
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
pub(super) fn in_round_rect(fx: f32, fy: f32, w: f32, h: f32, rad: f32) -> bool {
    if fx < 0.0 || fy < 0.0 || fx > w || fy > h {
        return false;
    }
    let cx = fx.clamp(rad, w - rad);
    let cy = fy.clamp(rad, h - rad);
    (fx - cx).powi(2) + (fy - cy).powi(2) <= rad * rad
}

pub(super) fn lerp_rgb(a: (u8, u8, u8), b: (u8, u8, u8), t: f32) -> (u8, u8, u8) {
    let mix = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t.clamp(0.0, 1.0)).round() as u8;
    (mix(a.0, b.0), mix(a.1, b.1), mix(a.2, b.2))
}

/// Filled rounded rectangle; `color` gets each pixel's absolute x so fills can carry a gradient.
pub(super) fn fill_round_rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, radius: Option<f32>, color: impl Fn(f32) -> (u8, u8, u8)) {
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
// Image — a picture scaled to fit its box
// ============================================================================

type ImageKey = (String, u32, u32, u64);
static IMAGE_CACHE: Mutex<Option<HashMap<ImageKey, Arc<Pixmap>>>> = Mutex::new(None);
const IMAGE_CACHE_LIMIT: usize = 32;

pub(super) fn raster_scaled(path: &str, w: u32, h: u32) -> Result<Pixmap> {
    let img = image::open(path).map_err(|e| anyhow::anyhow!("Decode image {path}: {e}"))?.to_rgba8();
    let (iw, ih) = img.dimensions();
    let scale = (w as f32 / iw as f32).min(h as f32 / ih as f32);
    let (tw, th) = (((iw as f32 * scale).round() as u32).max(1), ((ih as f32 * scale).round() as u32).max(1));
    let mut data = image::imageops::resize(&img, tw, th, image::imageops::FilterType::Lanczos3).into_raw();
    for px in data.chunks_exact_mut(4) {
        let alpha = px[3] as u16;
        for c in &mut px[..3] {
            *c = ((*c as u16 * alpha + 127) / 255) as u8;
        }
    }
    IntSize::from_wh(tw, th)
        .and_then(|size| Pixmap::from_vec(data, size))
        .ok_or_else(|| anyhow::anyhow!("Image {path} has unusable dimensions"))
}

/// The picture at `path` (PNG, JPEG, WebP, BMP, GIF or SVG) scaled to fit w×h (aspect kept), premultiplied, decoded once per file version and size.
pub(super) fn scaled_image(path: &str, w: u32, h: u32) -> Result<Arc<Pixmap>> {
    let modified = std::fs::metadata(path)
        .map_err(|e| anyhow::anyhow!("Read image {path}: {e}"))?
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let key = (path.to_string(), w, h, modified);
    if let Some(hit) = IMAGE_CACHE.lock().as_ref().and_then(|c| c.get(&key)) {
        return Ok(hit.clone());
    }
    let pixmap = if super::svg::is_svg(path) { super::svg::render_svg(std::path::Path::new(path), w, h)? } else { raster_scaled(path, w, h)? };
    let pixmap = Arc::new(pixmap);
    let mut cache = IMAGE_CACHE.lock();
    let cache = cache.get_or_insert_with(HashMap::new);
    if cache.len() >= IMAGE_CACHE_LIMIT {
        cache.clear();
    }
    cache.insert(key, pixmap.clone());
    Ok(pixmap)
}

pub(super) fn draw_image(pm: &mut Pixmap, el: &ImageElement) -> Result<()> {
    if el.path.is_empty() || el.width < 1.0 || el.height < 1.0 {
        return Ok(());
    }
    let scaled = scaled_image(&el.path, el.width.round() as u32, el.height.round() as u32)?;
    let paint = PixmapPaint { opacity: el.opacity.min(100) as f32 / 100.0, ..PixmapPaint::default() };
    let left = (el.x - scaled.width() as f32 / 2.0).round() as i32;
    let top = (el.y - scaled.height() as f32 / 2.0).round() as i32;
    pm.draw_pixmap(left, top, Pixmap::as_ref(&scaled), &paint, Transform::identity(), None);
    Ok(())
}

// ============================================================================
// Gauge — annular sector with pixel test
// ============================================================================

pub(super) fn metric_value(metric: MetricId, t: Temperatures) -> f64 {
    metric.value_from(t)
}

#[allow(clippy::manual_clamp)] // unlike clamp, max/min turn NaN into a bound instead of propagating it
pub(super) fn clamp01(v: f64) -> f64 {
    v.max(0.0).min(1.0)
}

pub(super) fn draw_gauge(
    pm: &mut Pixmap,
    font: &FontVec,
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
    let value_text = format!("{}{}", crate::types::format_metric(v, decimals), el.metric.unit());
    if el.show_value && !el.value_pill {
        let color = if warn { hex_to_rgb(&el.warn_color) } else { hex_to_rgb(&el.color) };
        lines.push((value_text.clone(), el.value_size, color));
    }
    if !lines.is_empty() {
        let cy = match el.text_position {
            TextPosition::Center => el.y,
            // Sit in the opening at the bottom of a split ring, just inside the outer edge.
            TextPosition::Bottom => el.y + r_out - 4.0 - stack_height(font, &lines)? / 2.0,
        };
        draw_centered_stack(pm, font, el.x, cy, &lines)?;
    }
    if el.show_value && el.value_pill {
        draw_value_pill(pm, font, el, r_in, r_out, &value_text, track_rgb)?;
    }
    if el.show_range && !full_circle {
        draw_range_ends(pm, font, el, r_mid, start, sweep, decimals)?;
    }
    Ok(())
}

/// The value in a slice of the ring itself at 12 o'clock: rounded ends, top and bottom cut by the ring's edges, filled
/// with the track colour, text in its inverse.
pub(super) fn draw_value_pill(pm: &mut Pixmap, font: &FontVec, el: &GaugeElement, r_in: f32, r_out: f32, text: &str, fill: (u8, u8, u8)) -> Result<()> {
    let band = r_out - r_in;
    let r_mid = (r_in + r_out) / 2.0;
    let size = (el.value_size * 0.5).min(band * 0.75).max(8.0);
    let m = measure(font, text, size)?;
    let len = m.width + band;
    let reach = (len / 2.0 / r_mid).min(PI);
    let x0 = (el.x - len / 2.0 - band).floor() as i32;
    let x1 = (el.x + len / 2.0 + band).ceil() as i32;
    let y0 = (el.y - r_out - 1.0).floor() as i32;
    let y1 = (el.y - r_in * reach.cos() + 1.0).ceil() as i32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let (dx, dy) = (x as f32 - el.x, y as f32 - el.y);
            let d = (dx * dx + dy * dy).sqrt();
            if d < r_in || d > r_out {
                continue;
            }
            let s = dx.atan2(-dy) * r_mid;
            if in_round_rect(s + len / 2.0, d - r_in, len, band, band / 2.0) {
                put_pixel(pm, x, y, fill.0, fill.1, fill.2);
            }
        }
    }
    let inverse = (255 - fill.0, 255 - fill.1, 255 - fill.2);
    draw_text(font, pm, el.x - m.width / 2.0, el.y - r_mid - m.height / 2.0, text, size, inverse)?;
    Ok(())
}

/// 0 and max placed on a circle (radius = offset) around the centre of each arc end; the angle picks the spot on it,
/// from 0° = toward the gauge centre, 90° = along the arc into the gauge, mirrored on the two ends.
pub(super) fn draw_range_ends(pm: &mut Pixmap, font: &FontVec, el: &GaugeElement, r_mid: f32, start: f32, sweep: f32, decimals: u8) -> Result<()> {
    let size = (el.value_size * 0.4).max(12.0);
    let max_decimals = if el.max.fract() == 0.0 { 0 } else { decimals };
    let (turn_sin, turn_cos) = el.range_angle.to_radians().sin_cos();
    let unit = el.metric.unit();
    let ends = [
        (start, 1.0, format!("{}{unit}", crate::types::format_metric(0.0, 0))),
        (start + sweep, -1.0, format!("{}{unit}", crate::types::format_metric(el.max, max_decimals))),
    ];
    for (angle, into_arc, text) in ends {
        let m = measure(font, &text, size)?;
        let (sin, cos) = angle.sin_cos();
        let inward = (-sin, cos);
        let along = (into_arc * cos, into_arc * sin);
        let (dx, dy) = (turn_cos * inward.0 + turn_sin * along.0, turn_cos * inward.1 + turn_sin * along.1);
        let cx = el.x + r_mid * sin + el.range_offset * dx;
        let cy = el.y - r_mid * cos + el.range_offset * dy;
        draw_text(font, pm, cx - m.width / 2.0, cy - m.height / 2.0, &text, size, (0x9a, 0xa0, 0xb4))?;
    }
    Ok(())
}

const STACK_GAP: f32 = 4.0;

pub(super) fn stack_height(font: &FontVec, lines: &[(String, f32, (u8, u8, u8))]) -> Result<f32> {
    let mut total = STACK_GAP * (lines.len().saturating_sub(1) as f32);
    for (s, sz, _) in lines {
        total += measure(font, s, *sz)?.height;
    }
    Ok(total)
}

pub(super) fn draw_centered_stack(
    pm: &mut Pixmap,
    font: &FontVec,
    cx: f32,
    cy: f32,
    lines: &[(String, f32, (u8, u8, u8))],
) -> Result<()> {
    let gap = 4.0;
    let measured: Vec<_> = lines
        .iter()
        .map(|(s, sz, _)| measure(font, s, *sz).map(|m| (m, *sz)))
        .collect::<Result<Vec<_>>>()?;
    let total: f32 = measured.iter().map(|(m, _)| m.height).sum::<f32>()
        + gap * (lines.len().saturating_sub(1) as f32);
    let mut cur = cy - total / 2.0;
    for ((text, _, color), (m, sz)) in lines.iter().zip(measured.iter()) {
        let x = cx - m.width / 2.0;
        let y = cur;
        draw_text(font, pm, x, y, text, *sz, *color)?;
        cur += m.height + gap;
    }
    Ok(())
}

// ============================================================================
// Bar — rounded rect track + filled portion + label/value row above
// ============================================================================

pub(super) fn draw_bar(pm: &mut Pixmap, font: &FontVec, el: &BarElement, temps: Temperatures, decimals: u8) -> Result<()> {
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
        draw_text(font, pm, left, row_y, &el.label, el.value_size, (0x9a, 0xa0, 0xb4))?;
    }
    if el.show_value {
        let s = format!("{}{}", crate::types::format_metric(v, decimals), el.metric.unit());
        let m = measure(font, &s, el.value_size)?;
        let x = left + el.width - m.width;
        draw_text(font, pm, x, row_y, &s, el.value_size, (0xff, 0xff, 0xff))?;
    }
    Ok(())
}

// ============================================================================
// Graph — panel, header row, and a line chart of `series` (oldest → newest)
// ============================================================================

pub(super) fn draw_graph(pm: &mut Pixmap, font: &FontVec, el: &GraphElement, series: &[f64], decimals: u8) -> Result<()> {
    let latest = series.last().copied().unwrap_or(0.0);
    let warn = latest >= el.warn_at;
    let line_rgb = hex_to_rgb(if warn { &el.warn_color } else { &el.color });

    let left = el.x - el.width / 2.0;
    let top = el.y - el.height / 2.0;
    fill_round_rect(pm, left, top, el.width, el.height, Some(el.corner_radius), |_| hex_to_rgb(&el.track_color));

    const PAD: f32 = 10.0;
    let mut plot_top = top + PAD;
    if el.show_label || el.show_value {
        let row_y = top + PAD;
        if el.show_label && !el.label.is_empty() {
            draw_text(font, pm, left + PAD, row_y, &el.label, el.value_size, (0x9a, 0xa0, 0xb4))?;
        }
        if el.show_value {
            let s = format!("{}{}", crate::types::format_metric(latest, decimals), el.metric.unit());
            let m = measure(font, &s, el.value_size)?;
            draw_text(font, pm, left + el.width - PAD - m.width, row_y, &s, el.value_size, line_rgb)?;
        }
        plot_top = row_y + measure(font, "0", el.value_size)?.height + 6.0;
    }
    let (plot_left, plot_right, plot_bottom) = (left + PAD, left + el.width - PAD, top + el.height - PAD);
    let plot_h = plot_bottom - plot_top;
    if series.len() < 2 || plot_h < 4.0 || plot_right <= plot_left {
        return Ok(());
    }

    // Newest sample sits on the right edge; a short history leaves the left side empty.
    let window = el.window_secs.max(2) as f32;
    let step = (plot_right - plot_left) / (window - 1.0);
    let point = |i: usize| {
        let age = (series.len() - 1 - i) as f32;
        let frac = (series[i] / el.max.max(0.0001)).clamp(0.0, 1.0) as f32;
        (plot_right - age * step, plot_bottom - frac * plot_h)
    };

    let mut line = tiny_skia::PathBuilder::new();
    line.move_to(point(0).0, point(0).1);
    for i in 1..series.len() {
        let (px, py) = point(i);
        line.line_to(px, py);
    }
    let Some(line_path) = line.finish() else { return Ok(()) };

    let mut paint = tiny_skia::Paint { anti_alias: true, ..Default::default() };
    // A flat line along the bottom encloses no area, which tiny-skia refuses (and warns about).
    let has_area = (0..series.len()).any(|i| point(i).1 < plot_bottom - 0.5);
    if el.fill && has_area {
        let mut area = tiny_skia::PathBuilder::new();
        area.move_to(point(0).0, plot_bottom);
        for i in 0..series.len() {
            let (px, py) = point(i);
            area.line_to(px, py);
        }
        area.line_to(plot_right, plot_bottom);
        area.close();
        if let Some(area) = area.finish() {
            paint.set_color_rgba8(line_rgb.0, line_rgb.1, line_rgb.2, 70);
            pm.fill_path(&area, &paint, tiny_skia::FillRule::Winding, tiny_skia::Transform::identity(), None);
        }
    }
    paint.set_color_rgba8(line_rgb.0, line_rgb.1, line_rgb.2, 255);
    let stroke = tiny_skia::Stroke {
        width: el.line_width.max(1.0),
        line_cap: tiny_skia::LineCap::Round,
        line_join: tiny_skia::LineJoin::Round,
        ..Default::default()
    };
    pm.stroke_path(&line_path, &paint, &stroke, tiny_skia::Transform::identity(), None);
    Ok(())
}

// ============================================================================
// Text element
// ============================================================================

pub(super) fn draw_text_element(
    pm: &mut Pixmap,
    font: &FontVec,
    el: &TextElement,
    temps: Temperatures,
    decimals: u8,
) -> Result<()> {
    let text = resolve_text(&el.text, temps, decimals);
    if text.is_empty() {
        return Ok(());
    }
    let m = measure(font, &text, el.size)?;
    use crate::types::TextAlign;
    let x = match el.align {
        TextAlign::Left => el.x,
        TextAlign::Center => el.x - m.width / 2.0,
        TextAlign::Right => el.x - m.width,
    };
    let y = el.y - m.height / 2.0;
    let color = hex_to_rgb(&el.color);
    draw_text(font, pm, x, y, &text, el.size, color)?;
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
pub(super) fn draw_centered(
    font: &FontVec,
    pm: &mut Pixmap,
    cx: f32,
    cy: f32,
    text: &str,
    size: f32,
    color: (u8, u8, u8),
) -> Result<()> {
    draw_text_centered(font, pm, cx, cy, text, size, color)
}
