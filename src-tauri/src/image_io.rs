//! Image + GIF I/O.
//!
//! - `image_to_device_rgba`: decode any common image format, cover-fit to
//!   640×640, return raw RGBA with alpha=0 (firmware format).
//! - `resize_gif`: decode animated GIF, resize each frame to 640×640, re-encode
//!   with palette quantization. Replaces the Python+PIL subprocess used in the
//!   Electron version.

use crate::types::{LCD_HEIGHT, LCD_WIDTH};
use anyhow::{anyhow, Result};
use image::{imageops::FilterType, ImageBuffer, Rgba};
use once_cell::sync::Lazy;
use std::io::Cursor;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Instant;

static LCD_QUARTER_TURNS: AtomicU8 = AtomicU8::new(0);

pub fn set_lcd_rotation(degrees: u16) {
    LCD_QUARTER_TURNS.store(((degrees / 90) % 4) as u8, Ordering::Relaxed);
}

/// Rotate a full-screen RGBA frame clockwise by the configured mount offset.
pub fn rotate_for_lcd(rgba: Vec<u8>) -> Vec<u8> {
    let turns = LCD_QUARTER_TURNS.load(Ordering::Relaxed);
    if turns == 0 || rgba.len() != (LCD_WIDTH * LCD_HEIGHT * 4) as usize {
        return rgba;
    }
    let img = ImageBuffer::<Rgba<u8>, _>::from_raw(LCD_WIDTH, LCD_HEIGHT, rgba).expect("length checked");
    match turns {
        1 => image::imageops::rotate90(&img),
        2 => image::imageops::rotate180(&img),
        _ => image::imageops::rotate270(&img),
    }
    .into_raw()
}

/// Decode an image (jpg/png/webp/bmp), cover-fit it to 640×640, return RGBA
/// with alpha forced to 0x00 (firmware requirement).
pub fn image_to_device_rgba(bytes: &[u8]) -> Result<Vec<u8>> {
    let img = image::load_from_memory(bytes).map_err(|e| anyhow!("Image decode: {e}"))?;
    let resized = img.resize_to_fill(LCD_WIDTH, LCD_HEIGHT, FilterType::Lanczos3);
    let rgba = resized.to_rgba8();
    let mut out = rgba.into_raw();
    // Force alpha = 0 on every pixel.
    let mut i = 3;
    while i < out.len() {
        out[i] = 0x00;
        i += 4;
    }
    Ok(out)
}

/// Fixed palette (216-colour cube + 40 greys) and its nearest-colour LUT, built once per process.
static PALETTE: Lazy<Vec<u8>> = Lazy::new(build_fixed_palette);
static LUT: Lazy<Vec<u8>> = Lazy::new(|| build_palette_lut(&PALETTE));

/// A GIF background decoded, scaled, dimmed and dithered to palette indices once,
/// so live stats only re-quantise the pixels they cover.
pub struct PreparedGif {
    repeat: gif::Repeat,
    /// Unrotated 640×640 palette indices + frame delay.
    frames: Vec<(Vec<u8>, u16)>,
}

impl PreparedGif {
    pub fn frame_count(&self) -> usize {
        self.frames.len()
    }
}

/// Resize + normalise an animated GIF to 640×640 with the fixed palette.
pub fn resize_gif(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut frames = Vec::new();
    let repeat = decode_frames(bytes, |rgba, delay| frames.push((rotate_indices(to_indices(&rgba)), delay)))?;
    encode_indexed(repeat, frames)
}

/// Decode a GIF background once; `dim` darkens it by that percentage like still backgrounds.
pub fn prepare_gif(bytes: &[u8], dim: u8) -> Result<PreparedGif> {
    let t0 = Instant::now();
    let keep = 100 - dim.min(90) as u16;
    let mut frames = Vec::new();
    let repeat = decode_frames(bytes, |mut rgba, delay| {
        for px in rgba.chunks_exact_mut(4) {
            for c in &mut px[..3] {
                *c = (*c as u16 * keep / 100) as u8;
            }
        }
        frames.push((to_indices(&rgba), delay));
    })?;
    log::debug!("GIF background prepared: {} frames in {:?}", frames.len(), t0.elapsed());
    Ok(PreparedGif { repeat, frames })
}

/// Composite a premultiplied RGBA overlay (640×640) onto every prepared frame and encode.
/// Only pixels the overlay touches are re-quantised; the rest reuse the cached indices.
pub fn encode_with_overlay(prepared: &PreparedGif, overlay: &[u8]) -> Result<Vec<u8>> {
    let t0 = Instant::now();
    let width = LCD_WIDTH as usize;
    let covered: Vec<(usize, &[u8])> = overlay.chunks_exact(4).enumerate().filter(|(_, px)| px[3] > 0).collect();
    let frames = prepared.frames.iter().map(|(bg, delay)| {
        let mut idx = bg.clone();
        for &(i, px) in &covered {
            let rgb = if px[3] == 255 {
                [px[0], px[1], px[2]]
            } else {
                // Premultiplied "over" against the cached background colour.
                let base = idx[i] as usize * 3;
                let inv = 255 - px[3] as u16;
                let over = |c: usize| (px[c] as u16 + PALETTE[base + c] as u16 * inv / 255).min(255) as u8;
                [over(0), over(1), over(2)]
            };
            idx[i] = LUT[dithered_lut_idx(&rgb, i % width, i / width)];
        }
        (rotate_indices(idx), *delay)
    });
    let out = encode_indexed(prepared.repeat, frames)?;
    log::debug!("GIF overlay encode: {} frames, {} covered px, {:?}", prepared.frames.len(), covered.len(), t0.elapsed());
    Ok(out)
}

/// Map a 640×640 RGBA frame to nearest palette indices. Deliberately undithered: dither noise
/// makes LZW frames ~4× larger, and every byte is re-uploaded on each stats change.
/// Only overlay pixels (gradients) are dithered, in `encode_with_overlay`.
fn to_indices(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4).map(|px| LUT[palette_lut_idx(px[0], px[1], px[2])]).collect()
}

/// Rotate a 640×640 index buffer by the configured mount offset.
fn rotate_indices(idx: Vec<u8>) -> Vec<u8> {
    let turns = LCD_QUARTER_TURNS.load(Ordering::Relaxed);
    if turns == 0 {
        return idx;
    }
    let img = image::GrayImage::from_raw(LCD_WIDTH, LCD_HEIGHT, idx).expect("640×640 index buffer");
    match turns {
        1 => image::imageops::rotate90(&img),
        2 => image::imageops::rotate180(&img),
        _ => image::imageops::rotate270(&img),
    }
    .into_raw()
}

fn encode_indexed(repeat: gif::Repeat, frames: impl IntoIterator<Item = (Vec<u8>, u16)>) -> Result<Vec<u8>> {
    let (w, h) = (LCD_WIDTH as u16, LCD_HEIGHT as u16);
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, w, h, &PALETTE).map_err(|e| anyhow!("GIF encoder: {e}"))?;
        enc.set_repeat(repeat).map_err(|e| anyhow!("GIF repeat: {e}"))?;
        for (n, (idx, delay)) in frames.into_iter().enumerate() {
            enc.write_frame(&make_gif_frame(w, h, delay, std::borrow::Cow::Owned(idx)))
                .map_err(|e| anyhow!("GIF write frame {n}: {e}"))?;
        }
    }
    Ok(out)
}

/// Decode every frame (all disposal methods), cover it onto an opaque canvas and scale to 640×640 RGBA.
fn decode_frames(bytes: &[u8], mut on_frame: impl FnMut(Vec<u8>, u16)) -> Result<gif::Repeat> {
    let tw32 = LCD_WIDTH;
    let th32 = LCD_HEIGHT;

    let mut opts = gif::DecodeOptions::new();
    opts.set_color_output(gif::ColorOutput::RGBA);
    let mut dec = opts
        .read_info(Cursor::new(bytes))
        .map_err(|e| anyhow!("GIF decode init: {e}"))?;

    let repeat   = dec.repeat();
    let canvas_w = dec.width()  as u32;
    let canvas_h = dec.height() as u32;
    let same_size = canvas_w == tw32 && canvas_h == th32;

    // Opaque-black canvas: transparent GIF areas → black rather than ghost
    // pixels from a previous frame.
    let mut canvas = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_pixel(
        canvas_w, canvas_h, Rgba([0, 0, 0, 255]),
    );

    while let Some(frame) = dec.read_next_frame().map_err(|e| anyhow!("GIF read: {e}"))? {
        let (delay, dispose) = (frame.delay, frame.dispose);
        let (left, top, fw, fh) = (frame.left as i32, frame.top as i32, frame.width as i32, frame.height as i32);
        let prev_snap = matches!(dispose, gif::DisposalMethod::Previous).then(|| canvas.clone());

        gif_composite(&mut canvas, canvas_w, canvas_h, left, top, fw, fh, &frame.buffer);
        on_frame(gif_resize(&canvas, same_size, tw32, th32), delay);
        gif_apply_disposal(&mut canvas, canvas_w, canvas_h, dispose, left, top, fw, fh, prev_snap);
    }
    Ok(repeat)
}

// ── GIF helpers ─────────────────────────────────────────────────────────────

fn gif_composite(
    canvas: &mut ImageBuffer<Rgba<u8>, Vec<u8>>,
    cw: u32, ch: u32,
    fx: i32, fy: i32, fw: i32, fh: i32,
    buf: &[u8],
) {
    for y in 0..fh {
        for x in 0..fw {
            let idx = ((y * fw + x) * 4) as usize;
            if idx + 3 >= buf.len() { continue; }
            if buf[idx + 3] == 0 { continue; }
            let cx = fx + x;
            let cy = fy + y;
            if cx < 0 || cy < 0 || cx >= cw as i32 || cy >= ch as i32 { continue; }
            *canvas.get_pixel_mut(cx as u32, cy as u32) =
                Rgba([buf[idx], buf[idx + 1], buf[idx + 2], 255]);
        }
    }
}

/// Resize canvas to target, or clone raw pixels if already the right size.
/// Uses Triangle (bilinear) filter — fast and smooth enough for an LCD panel.
fn gif_resize(
    canvas: &ImageBuffer<Rgba<u8>, Vec<u8>>,
    same_size: bool,
    tw: u32, th: u32,
) -> Vec<u8> {
    let mut rgba = if same_size {
        canvas.as_raw().to_vec()
    } else {
        image::imageops::resize(canvas, tw, th, FilterType::Triangle).into_raw()
    };
    // Guarantee fully opaque output so NeuQuant never emits a transparent index.
    for px in rgba.chunks_exact_mut(4) {
        px[3] = 255;
    }
    rgba
}

fn gif_apply_disposal(
    canvas: &mut ImageBuffer<Rgba<u8>, Vec<u8>>,
    cw: u32, ch: u32,
    dispose: gif::DisposalMethod,
    fx: i32, fy: i32, fw: i32, fh: i32,
    prev_snap: Option<ImageBuffer<Rgba<u8>, Vec<u8>>>,
) {
    match dispose {
        gif::DisposalMethod::Background => {
            for y in fy..(fy + fh) {
                for x in fx..(fx + fw) {
                    if x < 0 || y < 0 || x >= cw as i32 || y >= ch as i32 { continue; }
                    *canvas.get_pixel_mut(x as u32, y as u32) = Rgba([0, 0, 0, 255]);
                }
            }
        }
        gif::DisposalMethod::Previous => {
            if let Some(snap) = prev_snap {
                *canvas = snap;
            }
        }
        _ => {}
    }
}

fn make_gif_frame(
    w: u16, h: u16, delay: u16,
    buffer: std::borrow::Cow<[u8]>,
) -> gif::Frame<'static> {
    let mut f = gif::Frame::default();
    f.width   = w;
    f.height  = h;
    f.delay   = delay;
    f.dispose = gif::DisposalMethod::Keep;
    f.buffer  = match buffer {
        std::borrow::Cow::Owned(v)    => std::borrow::Cow::Owned(v),
        std::borrow::Cow::Borrowed(s) => std::borrow::Cow::Owned(s.to_vec()),
    };
    f
}

/// Map (r,g,b) to a 5-bit-per-channel index into the LUT.
#[inline(always)]
fn palette_lut_idx(r: u8, g: u8, b: u8) -> usize {
    ((r >> 3) as usize * 1024) + ((g >> 3) as usize * 32) + (b >> 3) as usize
}

const BAYER4: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/// Ordered (Bayer 4×4) dither before palette lookup so gradients don't band in the 216-colour cube.
/// Near-grey pixels get a small amplitude matching the fine grey ramp, so text stays clean.
fn dithered_lut_idx(px: &[u8], x: usize, y: usize) -> usize {
    let (r, g, b) = (px[0], px[1], px[2]);
    let chroma = r.max(g).max(b) - r.min(g).min(b);
    // 80% of the palette step: the 5-bit LUT adds up to ±4 of rounding, which a full step would push past exact colours.
    let step = if chroma < 8 { 6.5 } else { 51.0 * 0.8 };
    let offset = ((BAYER4[(y & 3) * 4 + (x & 3)] as f32 + 0.5) / 16.0 - 0.5) * step;
    let d = |c: u8| (c as f32 + offset).round().clamp(0.0, 255.0) as u8;
    palette_lut_idx(d(r), d(g), d(b))
}

/// Fixed 6×6×6 colour cube (216 entries) + 40 evenly-spaced greys = 256.
/// No per-GIF NeuQuant pass — deterministic, instantaneous to build.
fn build_fixed_palette() -> Vec<u8> {
    let steps: [u8; 6] = [0, 51, 102, 153, 204, 255];
    let mut pal = Vec::with_capacity(256 * 3);
    for &r in &steps {
        for &g in &steps {
            for &b in &steps {
                pal.push(r);
                pal.push(g);
                pal.push(b);
            }
        }
    }
    // 40 greys to fill the remaining 40 slots (index 216-255).
    for i in 0u8..40 {
        let v = ((i as u16 * 255) / 39) as u8;
        pal.push(v);
        pal.push(v);
        pal.push(v);
    }
    pal
}

/// Build a 32×32×32 lookup table: O(1) per-pixel nearest-colour lookup.
/// Building cost: 32 768 cells × 256 colours = 8 M comparisons, done ONCE.
fn build_palette_lut(palette: &[u8]) -> Vec<u8> {
    let mut lut = vec![0u8; 32 * 32 * 32];
    for r5 in 0u8..32 {
        for g5 in 0u8..32 {
            for b5 in 0u8..32 {
                // Spread 0..31 over the full 0..255 range so white maps to 255, not 248.
                let r = r5 as i32 * 255 / 31;
                let g = g5 as i32 * 255 / 31;
                let b = b5 as i32 * 255 / 31;
                let mut best = 0u8;
                let mut best_dist = i32::MAX;
                for (i, c) in palette.chunks_exact(3).enumerate() {
                    let dr = r - c[0] as i32;
                    let dg = g - c[1] as i32;
                    let db = b - c[2] as i32;
                    let dist = dr * dr + dg * dg + db * db;
                    if dist < best_dist {
                        best_dist = dist;
                        best = i as u8;
                    }
                }
                lut[palette_lut_idx(r5 * 8, g5 * 8, b5 * 8)] = best;
            }
        }
    }
    lut
}

/// Convenience: render a PNG buffer back to RGBA for device.
pub fn png_bytes_to_device_rgba(bytes: &[u8]) -> Result<Vec<u8>> {
    image_to_device_rgba(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quantise(px: [u8; 3], x: usize, y: usize, pal: &[u8], lut: &[u8]) -> [u8; 3] {
        let i = lut[dithered_lut_idx(&[px[0], px[1], px[2], 255], x, y)] as usize * 3;
        [pal[i], pal[i + 1], pal[i + 2]]
    }

    fn two_frame_gif() -> Vec<u8> {
        use image::{codecs::gif::GifEncoder, Frame, RgbaImage};
        let mut bytes = Vec::new();
        {
            let mut enc = GifEncoder::new(&mut bytes);
            for shade in [0u8, 102] {
                enc.encode_frame(Frame::new(RgbaImage::from_pixel(32, 32, Rgba([shade, shade, 204, 255])))).unwrap();
            }
        }
        bytes
    }

    fn decode_indexed(gif: &[u8]) -> Vec<Vec<u8>> {
        let mut opts = gif::DecodeOptions::new();
        opts.set_color_output(gif::ColorOutput::Indexed);
        let mut dec = opts.read_info(Cursor::new(gif)).unwrap();
        let mut frames = Vec::new();
        while let Some(f) = dec.read_next_frame().unwrap() {
            frames.push(f.buffer.to_vec());
        }
        frames
    }

    #[test]
    fn overlay_replaces_only_covered_pixels_on_every_frame() {
        let prepared = prepare_gif(&two_frame_gif(), 0).unwrap();
        assert_eq!(prepared.frame_count(), 2);

        let mut overlay = vec![0u8; (LCD_WIDTH * LCD_HEIGHT * 4) as usize];
        let covered = 100 * LCD_WIDTH as usize + 100;
        overlay[covered * 4..covered * 4 + 4].copy_from_slice(&[255, 0, 0, 255]);

        let frames = decode_indexed(&encode_with_overlay(&prepared, &overlay).unwrap());
        assert_eq!(frames.len(), 2);
        for (out, (bg, _)) in frames.iter().zip(&prepared.frames) {
            let c = out[covered] as usize * 3;
            assert_eq!(&PALETTE[c..c + 3], &[255, 0, 0], "overlay pixel drawn");
            let untouched = 300 * LCD_WIDTH as usize + 300;
            assert_eq!(out[untouched], bg[untouched], "background reused from cache");
        }
        assert_ne!(frames[0][5], frames[1][5], "frames keep their own background");
    }

    /// `cargo test --release -- --ignored --nocapture gif_overlay_timing` with NZXT_BENCH_GIF=<path>.
    #[test]
    #[ignore]
    fn gif_overlay_timing() {
        let bytes = std::fs::read(std::env::var("NZXT_BENCH_GIF").unwrap()).unwrap();
        let t = Instant::now();
        let prepared = prepare_gif(&bytes, 40).unwrap();
        println!("prepare: {} frames in {:?}", prepared.frame_count(), t.elapsed());
        let empty = vec![0u8; (LCD_WIDTH * LCD_HEIGHT * 4) as usize];
        let mut rings = empty.clone();
        for (i, px) in rings.chunks_exact_mut(4).enumerate() {
            let (dx, dy) = ((i % 640) as f32 - 320.0, (i / 640) as f32 - 320.0);
            let d = (dx * dx + dy * dy).sqrt();
            if (160.0..290.0).contains(&d) && ((290.0 - d) % 50.0) < 40.0 {
                px.copy_from_slice(&[200, (d / 2.0) as u8, 50, 255]); // three gradient-ish rings
            }
        }
        for (name, overlay) in [("no overlay", &empty), ("three rings", &rings)] {
            let t = Instant::now();
            let out = encode_with_overlay(&prepared, overlay).unwrap();
            println!("overlay encode ({name}): {:?} ({} KB)", t.elapsed(), out.len() / 1024);
        }
    }

    #[test]
    fn dither_keeps_palette_colours_and_smooths_gradients() {
        let pal = build_fixed_palette();
        let lut = build_palette_lut(&pal);
        for y in 0..4 {
            for x in 0..4 {
                assert_eq!(quantise([255, 255, 255], x, y, &pal, &lut), [255, 255, 255], "white text stays white");
                assert_eq!(quantise([0, 204, 102], x, y, &pal, &lut), [0, 204, 102], "cube colours are exact");
            }
        }
        // A 4×4 tile of an in-between green should average back to roughly its true value.
        for g in [120u8, 140, 170, 190] {
            let mean: f32 = (0..16).map(|i| quantise([0, g, 60], i % 4, i / 4, &pal, &lut)[1] as f32).sum::<f32>() / 16.0;
            assert!((mean - g as f32).abs() < 8.0, "green {g} dithers to mean {mean}");
        }
    }
}
