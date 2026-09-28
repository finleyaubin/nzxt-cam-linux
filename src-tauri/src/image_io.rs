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

/// Resize + normalise an animated GIF to 640×640.
///
/// Design goals (in priority order):
///   1. No visual artefacts  — single global palette, DisposalMethod::Keep,
///                             fully opaque canvas.
///   2. Fast                 — streaming (one frame in memory at a time),
///                             Triangle filter, NeuQuant speed=30, O(1) LUT
///                             for palette mapping.
///   3. Correct              — handles all GIF disposal methods, loops, delays.
pub fn resize_gif(bytes: &[u8]) -> Result<Vec<u8>> {
    transcode_gif(bytes, |frame| frame)
}

/// Like `resize_gif`, but passes each 640×640 RGBA frame through `per_frame` before encoding.
pub fn transcode_gif(bytes: &[u8], mut per_frame: impl FnMut(Vec<u8>) -> Vec<u8>) -> Result<Vec<u8>> {
    let t0 = Instant::now();
    let target_w = LCD_WIDTH as u16;
    let target_h = LCD_HEIGHT as u16;
    let tw32 = target_w as u32;
    let th32 = target_h as u32;

    // ── Decoder setup ───────────────────────────────────────────────────────
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

    // Fixed 6×6×6 colour cube palette (216 colours + 40 greys) — built once,
    // no NeuQuant pass needed. Good enough for an LCD panel, eliminates the
    // per-GIF quantisation step entirely.
    let global_pal = build_fixed_palette();
    let lut = build_palette_lut(&global_pal);
    log::debug!("GIF palette+LUT ready: {:?}", t0.elapsed());

    // ── Stream-encode all frames (constant memory — no Vec<OutFrame>) ───────
    let mut out = Vec::with_capacity(bytes.len());
    let mut frame_n = 0usize;
    {
        let mut enc = gif::Encoder::new(&mut out, target_w, target_h, &global_pal)
            .map_err(|e| anyhow!("GIF encoder: {e}"))?;
        enc.set_repeat(repeat)
            .map_err(|e| anyhow!("GIF repeat: {e}"))?;

        while let Some(frame) = dec
            .read_next_frame()
            .map_err(|e| anyhow!("GIF read: {e}"))?
        {
            let tf = Instant::now();
            let (delay, dispose) = (frame.delay, frame.dispose);
            let (left, top, fw, fh) = (
                frame.left as i32, frame.top as i32,
                frame.width as i32, frame.height as i32,
            );
            let prev_snap = if matches!(dispose, gif::DisposalMethod::Previous) {
                Some(canvas.clone())
            } else {
                None
            };

            gif_composite(&mut canvas, canvas_w, canvas_h, left, top, fw, fh, &frame.buffer);

            let rgba = rotate_for_lcd(per_frame(gif_resize(&canvas, same_size, tw32, th32)));
            let indices: Vec<u8> = rgba
                .chunks_exact(4)
                .enumerate()
                .map(|(i, px)| lut[dithered_lut_idx(px, i % tw32 as usize, i / tw32 as usize)])
                .collect();

            enc.write_frame(&make_gif_frame(
                target_w, target_h, delay,
                std::borrow::Cow::Owned(indices),
            ))
            .map_err(|e| anyhow!("GIF write frame {frame_n}: {e}"))?;

            gif_apply_disposal(
                &mut canvas, canvas_w, canvas_h,
                dispose, left, top, fw, fh, prev_snap,
            );
            log::debug!("GIF frame {frame_n}: {:?}", tf.elapsed());
            frame_n += 1;
        }
    }
    log::debug!("GIF total encode: {:?} ({frame_n} frames, {} bytes out)", t0.elapsed(), out.len());
    Ok(out)
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
