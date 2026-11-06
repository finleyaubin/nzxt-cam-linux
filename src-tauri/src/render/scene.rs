//! Scene renderer — gauges (annular sector), bars (rounded rect), text.
//!
//! Mirrors render.ts from the Electron app. The pixel-perfect arc filling uses
//! the same per-pixel angle test the JS code does (simple and accurate; no
//! bezier approximation needed at 640×640).

use crate::image_io;
use crate::render::draw::*;
use crate::render::fonts::{lookup, resolve};
use crate::types::{hex_to_rgb, DisplayConfig, DisplayElement, Temperatures, LCD_SIZE};
use anyhow::Result;
use parking_lot::Mutex;
use std::sync::Arc;
use tiny_skia::Pixmap;

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
    Gif {
        bytes: Vec<u8>,
        first: Vec<u8>,
        /// Frames decoded + dithered once, keyed by the dim level they were prepared with.
        prepared: Mutex<Option<(u8, Arc<image_io::PreparedGif>)>>,
    },
}

/// What sits under the elements.
enum Base<'a> {
    Color,
    Image(&'a [u8]),
    /// Overlay only, composited onto cached GIF frames later.
    Transparent,
}

static BACKGROUND: Mutex<Option<(String, Arc<Background>)>> = Mutex::new(None);

fn load_background(path: &str) -> Result<Arc<Background>> {
    let mut cache = BACKGROUND.lock();
    if let Some((cached, bg)) = cache.as_ref() {
        if cached == path {
            return Ok(bg.clone());
        }
    }
    let bytes = image_io::read_image_file(path)?;
    let first = image_io::image_to_device_rgba(&bytes)?;
    let bg = Arc::new(if bytes.starts_with(b"GIF8") {
        Background::Gif { bytes, first, prepared: Mutex::new(None) }
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
        None => Ok(LcdFrame::Rgba(pixmap_to_device_rgba(&render_scene(config, temps, Base::Color)?))),
        Some(Background::Still(bg)) => Ok(LcdFrame::Rgba(pixmap_to_device_rgba(&render_scene(config, temps, Base::Image(bg))?))),
        Some(Background::Gif { bytes, prepared, .. }) => {
            let dim = config.background_dim.min(90);
            let frames = {
                let mut cache = prepared.lock();
                match cache.as_ref() {
                    Some((d, p)) if *d == dim => p.clone(),
                    _ => {
                        let p = Arc::new(image_io::prepare_gif(bytes, dim)?);
                        *cache = Some((dim, p.clone()));
                        p
                    }
                }
            };
            let overlay = render_scene(config, temps, Base::Transparent)?;
            Ok(LcdFrame::Gif(image_io::encode_with_overlay(&frames, overlay.data())?))
        }
    }
}

/// Render a scene to a PNG byte stream (for the WYSIWYG preview). GIF backgrounds show their first frame.
pub fn render_preview_png(config: &DisplayConfig, temps: Temperatures) -> Result<Vec<u8>> {
    let background = config.background_image.as_deref().map(load_background).transpose()?;
    let base = match background.as_deref() {
        Some(Background::Still(rgba) | Background::Gif { first: rgba, .. }) => Base::Image(rgba),
        None => Base::Color,
    };
    let pixmap = render_scene(config, temps, base)?;
    let png = pixmap.encode_png().map_err(|e| anyhow::anyhow!("PNG encode: {e}"))?;
    Ok(png)
}

// ============================================================================
// Top-level rendering
// ============================================================================

fn render_scene(config: &DisplayConfig, temps: Temperatures, base: Base) -> Result<Pixmap> {
    let mut pixmap = Pixmap::new(LCD_SIZE, LCD_SIZE)
        .ok_or_else(|| anyhow::anyhow!("Pixmap allocation failed"))?;

    match base {
        Base::Image(rgba) => fill_image(&mut pixmap, rgba, config.background_dim.min(90)),
        Base::Color => {
            let (br, bg, bb) = hex_to_rgb(&config.background);
            fill_solid(&mut pixmap, br, bg, bb);
        }
        Base::Transparent => {}
    }

    let scene_font = resolve(config.font.as_deref())?;

    let decimals = config.decimals.min(2);
    for el in &config.elements {
        match el {
            DisplayElement::Gauge(g) => {
                if let Err(e) = draw_gauge(&mut pixmap, &scene_font, g, temps, decimals) {
                    log::warn!("gauge draw error: {e}");
                }
            }
            DisplayElement::Bar(b) => {
                if let Err(e) = draw_bar(&mut pixmap, &scene_font, b, temps, decimals) {
                    log::warn!("bar draw error: {e}");
                }
            }
            DisplayElement::Graph(g) => {
                let mut series = crate::sensors::history::series(g.metric, g.window_secs as usize);
                series.push(g.metric.value_from(temps)); // the live reading is always the right-most point
                if let Err(e) = draw_graph(&mut pixmap, &scene_font, g, &series, decimals) {
                    log::warn!("graph draw error: {e}");
                }
            }
            DisplayElement::Text(t) => {
                let own = t.font.as_deref().and_then(lookup).unwrap_or_else(|| scene_font.clone());
                if let Err(e) = draw_text_element(&mut pixmap, &own, t, temps, decimals) {
                    log::warn!("text draw error: {e}");
                }
            }
            DisplayElement::Image(i) => {
                if let Err(e) = draw_image(&mut pixmap, i) {
                    log::warn!("image draw error: {e}");
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::fonts::measure;
    use crate::types::{BarElement, GaugeElement, GraphElement, ImageElement, MetricId, TextElement, TextPosition};
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
            value_size: 20.0, corner_radius: 20.0, gradient_to: Some("#ffffff".into()), text_position: Default::default(), show_range: false, range_angle: 0.0, range_offset: 0.0, value_pill: false,
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

    fn range_frame(show_range: bool, sweep: f32, range_angle: f32, range_offset: f32) -> Vec<u8> {
        let gauge = GaugeElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 300.0, thickness: 40.0, max: 100.0,
            color: "#ff0000".into(), track_color: "#0000ff".into(), start_angle: -135.0, sweep,
            warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: false, show_label: false, label: String::new(),
            value_size: 40.0, corner_radius: 0.0, gradient_to: None, text_position: TextPosition::default(), show_range, range_angle, range_offset, value_pill: false,
        };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures::default()).unwrap() else { panic!() };
        rgba
    }

    fn changed_pixels(a: &[u8], b: &[u8]) -> Vec<(f32, f32)> {
        let n = LCD_SIZE as usize;
        (0..a.len() / 4).filter(|&i| a[i * 4..i * 4 + 3] != b[i * 4..i * 4 + 3]).map(|i| ((i % n) as f32 - 320.0, (i / n) as f32 - 320.0)).collect()
    }

    fn distance(p: (f32, f32)) -> f32 {
        (p.0 * p.0 + p.1 * p.1).sqrt()
    }

    fn label_centroid(off: &[u8], on: &[u8], left: bool) -> (f32, f32) {
        let pts: Vec<_> = changed_pixels(off, on).into_iter().filter(|p| (p.0 < 0.0) == left).collect();
        let n = pts.len() as f32;
        assert!(n > 20.0, "a label was drawn");
        (pts.iter().map(|p| p.0).sum::<f32>() / n, pts.iter().map(|p| p.1).sum::<f32>() / n)
    }

    #[test]
    fn range_labels_start_at_the_centre_of_each_arc_end() {
        let off = range_frame(false, 270.0, 0.0, 0.0);
        let on = range_frame(true, 270.0, 0.0, 0.0);
        let (min, max) = (label_centroid(&off, &on, true), label_centroid(&off, &on, false));
        let clock_deg = |p: (f32, f32)| p.0.atan2(-p.1).to_degrees();
        assert!((distance(min) - 280.0).abs() < 8.0 && (distance(max) - 280.0).abs() < 8.0, "on the ring's mid-line");
        assert!((clock_deg(min) + 135.0).abs() < 6.0, "min at the arc start");
        assert!((clock_deg(max) - 135.0).abs() < 6.0, "max at the arc end");
        let xs: Vec<f32> = changed_pixels(&off, &on).into_iter().filter(|p| p.0 < 0.0).map(|p| p.0).collect();
        let drawn_width = xs.iter().cloned().fold(f32::MIN, f32::max) - xs.iter().cloned().fold(f32::MAX, f32::min);
        assert!(drawn_width > measure(&resolve(None).unwrap(), "0", 16.0).unwrap().width + 3.0, "the unit is drawn after the number");
        assert_eq!(range_frame(false, 360.0, 0.0, 0.0), range_frame(true, 360.0, 0.0, 0.0), "full rings have no ends to label");
    }

    #[test]
    fn range_angle_and_offset_place_labels_on_a_circle_around_each_arc_end() {
        let off = range_frame(false, 270.0, 0.0, 0.0);
        let near = |angle: f32, offset: f32, min: (f32, f32), max: (f32, f32)| {
            let on = range_frame(true, 270.0, angle, offset);
            for (got, want, side) in [(label_centroid(&off, &on, true), min, "min"), (label_centroid(&off, &on, false), max, "max")] {
                let miss = ((got.0 - want.0).powi(2) + (got.1 - want.1).powi(2)).sqrt();
                assert!(miss < 10.0, "{side} at angle {angle}: got {got:?}, want {want:?}");
            }
        };
        near(0.0, 40.0, (-169.7, 169.7), (169.7, 169.7));
        near(90.0, 40.0, (-226.3, 169.7), (226.3, 169.7));
        near(180.0, 40.0, (-226.3, 226.3), (226.3, 226.3));
    }

    #[test]
    fn value_pill_is_cut_from_the_ring_with_inverse_text_and_leaves_the_centre_empty() {
        let render = |value_pill: bool| {
            let gauge = GaugeElement {
                id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 300.0, thickness: 40.0, max: 100.0,
                color: "#ff0000".into(), track_color: "#0000ff".into(), start_angle: -135.0, sweep: 270.0,
                warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: true, show_label: false, label: String::new(),
                value_size: 40.0, corner_radius: 0.0, gradient_to: None, text_position: TextPosition::default(), show_range: false, range_angle: 0.0, range_offset: 0.0, value_pill,
            };
            let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
            let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures { cpu: 100.0, ..Temperatures::default() }).unwrap() else { panic!() };
            rgba
        };
        let (plain, pill) = (render(false), render(true));
        let px = |f: &[u8], x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [f[i], f[i + 1], f[i + 2]] };
        let blue_in_row = |f: &[u8]| (250..390).filter(|&x| px(f, x, 40) == [0, 0, 255]).count();
        assert_eq!(blue_in_row(&plain), 0, "the full ring is solid fill at the top");
        assert!(blue_in_row(&pill) > 20, "the pill shows the track colour across the ring");
        assert_eq!(px(&pill, 320, 15), [0, 0, 0], "nothing is drawn outside the ring's outer edge");
        assert_eq!(px(&pill, 320, 70), [0, 0, 0], "nothing is drawn inside the ring's inner edge");
        let inverse_text = (25..55).flat_map(|y| (250..390).map(move |x| (x, y))).filter(|&(x, y)| { let p = px(&pill, x, y); p[0] > 200 && p[1] > 200 && p[2] < 80 }).count();
        assert!(inverse_text > 10, "the text is the inverse of the track colour");
        let lit_near_centre = |f: &[u8]| (220..420).flat_map(|y| (220..420).map(move |x| (x, y))).filter(|&(x, y)| px(f, x, y) != [0, 0, 0]).count();
        assert!(lit_near_centre(&plain) > 50, "the value is normally drawn in the centre");
        assert_eq!(lit_near_centre(&pill), 0, "with the pill the centre is empty");
    }

    fn image_frame(file: &str, size: (u32, u32), opacity: u8) -> Vec<u8> {
        let path = std::env::temp_dir().join(file);
        RgbaImage::from_pixel(size.0, size.1, Rgba([255, 0, 0, 255])).save(&path).unwrap();
        let img = ImageElement { id: "i".into(), x: 320.0, y: 320.0, width: 100.0, height: 100.0, path: path.to_string_lossy().into_owned(), opacity };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Image(img)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures::default()).unwrap() else { panic!("expected rgba") };
        rgba
    }

    #[test]
    fn image_is_scaled_to_fit_the_box_keeping_its_aspect() {
        let frame = image_frame("nzxt-img-wide.png", (40, 20), 100);
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [frame[i], frame[i + 1], frame[i + 2]] };
        assert_eq!(px(320, 320), [255, 0, 0], "centre is covered");
        assert_eq!(px(275, 320), [255, 0, 0], "fills the box width");
        assert_eq!(px(320, 340), [255, 0, 0], "a 2:1 picture is 50px tall");
        assert_eq!(px(320, 355), [0, 0, 0], "the box's spare height stays background");
        assert_eq!(px(260, 320), [0, 0, 0], "nothing outside the box");
    }

    #[test]
    fn svg_logos_are_rasterised_to_fit_the_box() {
        let path = std::env::temp_dir().join("nzxt-img-logo.svg");
        std::fs::write(&path, r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#ff0000"/></svg>"##).unwrap();
        let img = ImageElement { id: "i".into(), x: 320.0, y: 320.0, width: 100.0, height: 100.0, path: path.to_string_lossy().into_owned(), opacity: 100 };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Image(img)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(frame) = render_for_device(&cfg, Temperatures::default()).unwrap() else { panic!("expected rgba") };
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [frame[i], frame[i + 1], frame[i + 2]] };
        assert_eq!(px(320, 320), [255, 0, 0], "centre is covered");
        assert_eq!(px(275, 320), [255, 0, 0], "a 2:1 svg fills the box width");
        assert_eq!(px(320, 355), [0, 0, 0], "and leaves the spare height as background");
    }

    #[test]
    fn image_opacity_blends_with_the_background() {
        let frame = image_frame("nzxt-img-half.png", (20, 20), 50);
        let i = (320 * LCD_SIZE as usize + 320) * 4;
        assert!((frame[i] as i32 - 128).abs() <= 2 && frame[i + 1] == 0, "half-transparent red over black, got {:?}", &frame[i..i + 3]);
    }

    #[test]
    fn missing_image_draws_nothing_and_does_not_fail_the_frame() {
        let img = ImageElement { id: "i".into(), x: 320.0, y: 320.0, width: 100.0, height: 100.0, path: "/nonexistent/logo.png".into(), opacity: 100 };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Image(img)], ..DisplayConfig::default() };
        assert!(render_for_device(&cfg, Temperatures::default()).is_ok());
    }

    #[test]
    fn split_ring_puts_its_text_in_the_bottom_opening() {
        let gauge = GaugeElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 200.0, thickness: 30.0, max: 100.0,
            color: "#ff0000".into(), track_color: "#0000ff".into(), start_angle: -135.0, sweep: 270.0,
            warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: true, show_label: false, label: String::new(),
            value_size: 48.0, corner_radius: 0.0, gradient_to: None, text_position: TextPosition::Bottom,
            show_range: false, range_angle: 0.0, range_offset: 0.0, value_pill: false,
        };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures { cpu: 50.0, ..Temperatures::default() }).unwrap() else { panic!() };
        let red_in = |x0: usize, x1: usize, y0: usize, y1: usize| {
            (y0..y1).flat_map(|y| (x0..x1).map(move |x| (x, y)))
                .filter(|&(x, y)| { let i = (y * LCD_SIZE as usize + x) * 4; rgba[i] > 200 && rgba[i + 2] < 60 })
                .count()
        };
        assert!(red_in(270, 370, 440, 520) > 100, "value text sits in the bottom opening");
        assert_eq!(red_in(270, 370, 290, 350), 0, "the middle of the ring stays empty");
    }

    #[test]
    fn negative_start_angle_draws_whole_gauge() {
        let gauge = GaugeElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, radius: 300.0, thickness: 40.0, max: 100.0,
            color: "#ff0000".into(), track_color: "#0000ff".into(), start_angle: -135.0, sweep: 270.0,
            warn_color: "#ff0000".into(), warn_at: 1000.0, show_value: false, show_label: false, label: String::new(),
            value_size: 20.0, corner_radius: 0.0, gradient_to: None, text_position: Default::default(), show_range: false, range_angle: 0.0, range_offset: 0.0, value_pill: false,
        };
        let cfg = DisplayConfig { background: "#000000".into(), elements: vec![DisplayElement::Gauge(gauge)], ..DisplayConfig::default() };
        let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures { cpu: 100.0, ..Temperatures::default() }).unwrap() else { panic!() };
        let px = |x: usize, y: usize| { let i = (y * LCD_SIZE as usize + x) * 4; [rgba[i], rgba[i + 1], rgba[i + 2]] };
        assert_eq!(px(40, 320), [255, 0, 0], "9 o'clock is inside a -135°..135° gauge");
        assert_eq!(px(320, 40), [255, 0, 0], "12 o'clock");
        assert_eq!(px(320, 600), [0, 0, 0], "gap stays at the bottom");
    }

    fn graph(fill: bool) -> GraphElement {
        GraphElement {
            id: "g".into(), x: 320.0, y: 320.0, metric: MetricId::Cpu, width: 400.0, height: 200.0, max: 100.0,
            color: "#00ff00".into(), track_color: "#000040".into(), warn_color: "#ff0000".into(), warn_at: 1000.0,
            show_value: false, show_label: false, label: String::new(), value_size: 20.0,
            window_secs: 60, fill, line_width: 4.0, corner_radius: 0.0,
        }
    }

    fn pixel(pm: &Pixmap, x: u32, y: u32) -> [u8; 3] {
        let p = pm.pixel(x, y).unwrap();
        [p.red(), p.green(), p.blue()]
    }

    #[test]
    fn graph_draws_panel_and_line_against_the_right_edge() {
        let mut pm = Pixmap::new(LCD_SIZE, LCD_SIZE).unwrap();
        // Two samples: 0 then 100. The line ends at the top-right of the plot area.
        draw_graph(&mut pm, &crate::render::fonts::font().unwrap(), &graph(false), &[0.0, 100.0], 0).unwrap();
        assert_eq!(pixel(&pm, 130, 230), [0, 0, 0x40], "panel corner (square) is track coloured");
        // Panel spans x 120..520, y 220..420; with 10px padding the plot's top-right corner is (510, 230).
        let end = pixel(&pm, 509, 231);
        assert!(end[1] > 200 && end[0] < 60, "line reaches the top-right of the plot: {end:?}");
        assert_eq!(pixel(&pm, 400, 300), [0, 0, 0x40], "the plot is empty away from the line");
        assert_eq!(pixel(&pm, 200, 300), [0, 0, 0x40], "short history leaves the left empty");
    }

    #[test]
    fn graph_fill_tints_under_the_line_only() {
        let mut pm = Pixmap::new(LCD_SIZE, LCD_SIZE).unwrap();
        draw_graph(&mut pm, &crate::render::fonts::font().unwrap(), &graph(true), &[100.0, 100.0, 100.0], 0).unwrap();
        // Flat line at the top; the area below it is tinted, the panel margin is not.
        let under = pixel(&pm, 500, 400);
        assert!(under[1] > 0x10, "area under the line is tinted: {under:?}");
        assert_eq!(pixel(&pm, 125, 400), [0, 0, 0x40], "outside the plot padding stays track coloured");
    }

    #[test]
    fn graph_with_one_sample_draws_only_the_panel() {
        let mut pm = Pixmap::new(LCD_SIZE, LCD_SIZE).unwrap();
        draw_graph(&mut pm, &crate::render::fonts::font().unwrap(), &graph(true), &[50.0], 0).unwrap();
        assert_eq!(pixel(&pm, 320, 320), [0, 0, 0x40]);
    }

    #[test]
    fn chosen_font_changes_the_rendered_text() {
        let text = |font: Option<String>| TextElement {
            id: "t".into(), x: 320.0, y: 320.0, text: "Hamburgefonstiv 0123".into(), color: "#ffffff".into(),
            size: 48.0, align: crate::types::TextAlign::Center, font,
        };
        let render = |font: Option<&str>, element_font: Option<&str>| {
            let cfg = DisplayConfig {
                background: "#000000".into(),
                font: font.map(String::from),
                elements: vec![DisplayElement::Text(text(element_font.map(String::from)))],
                ..DisplayConfig::default()
            };
            let LcdFrame::Rgba(rgba) = render_for_device(&cfg, Temperatures::default()).unwrap() else { panic!("expected rgba") };
            rgba
        };
        let default = render(None, None);
        let Some(other) = crate::render::fonts::font_entries().into_iter().map(|e| e.family).find(|f| {
            let r = render(Some(f), None);
            r != default
        }) else {
            return;
        };
        assert_eq!(render(Some(&other), None), render(None, Some(&other)), "scene font and element font agree");
        assert_eq!(render(Some(&other), Some("No Such Font Family 123")), render(Some(&other), None), "an unknown element font falls back to the scene font");
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
