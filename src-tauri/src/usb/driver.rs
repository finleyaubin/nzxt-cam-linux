//! NZXT Kraken USB driver — port of kraken-driver.ts to Rust + nusb 0.2.
//!
//! Critical rules (learned the hard way on the Electron version):
//! 1. Header (MAGIC + bulk_info) must be a SEPARATE bulk transfer from the
//!    image data — concatenating them silently corrupts firmware decoding
//!    (ACKs still come back as code=1).
//! 2. RGBA pixels must have alpha = 0x00 when sent to the device, else colors
//!    are mangled.
//! 3. The host must drain stale interrupt responses before starting a new
//!    transaction, otherwise our `read_until` matches the previous ACK.
//! 4. Bucket memory offsets must be computed to avoid overlapping previously
//!    written buckets — `get_bucket_memory_offset` mirrors liquidctl's logic.

use crate::types::{DeviceStatus, DisplayConfig, Temperatures, LCD_HEIGHT, LCD_WIDTH};
use crate::usb::protocol::*;
use anyhow::{anyhow, bail, Result};
use nusb::transfer::{Buffer, Bulk, BulkOrInterrupt, EndpointDirection, In, Interrupt, Out, TransferError};
use nusb::{Device, Endpoint, Interface};
use parking_lot::{Mutex as PlMutex, RwLock};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

mod transport;
use transport::*;

// ============================================================================
// Hardware bundle — populated on connect, dropped on disconnect
// ============================================================================
struct Hardware {
    _device: Device,
    _iface0: Interface,
    _iface1: Interface,
    bulk_out: Endpoint<Bulk, Out>,
    intr_out: Endpoint<Interrupt, Out>,
    /// Polling task shutdown signal.
    poll_shutdown: Option<oneshot::Sender<()>>,
    /// Receiver fed by the polling task with raw interrupt-in packets.
    intr_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    /// Bucket currently shown on the LCD, so a full memory can be reclaimed without blanking it.
    active_bucket: Option<u8>,
    /// Which connection these handles belong to (see `Inner::conn_id`).
    conn_id: u32,
    /// Cleared by the interrupt poller when the USB link dies, so I/O can bail out instead of waiting on timeouts.
    alive: Arc<AtomicBool>,
}

impl Hardware {
    fn ensure_alive(&self) -> Result<()> {
        if self.alive.load(Ordering::Acquire) {
            Ok(())
        } else {
            bail!("USB link to the Kraken was lost")
        }
    }
}

// ============================================================================
// Link health tuning
// ============================================================================

/// How often the watcher looks for a missing device.
const WATCH_EVERY: Duration = Duration::from_secs(3);
/// A watcher tick this far apart (wall clock) means the machine slept in between.
const RESUME_GAP: Duration = Duration::from_secs(15);
/// Consecutive transfer errors the interrupt poller tolerates before giving up on the link.
const MAX_POLL_ERRORS: u32 = 5;
/// Consecutive failed LCD uploads before the link is declared lost.
const MAX_PUSH_FAILURES: u32 = 3;
/// A whole LCD upload (every protocol step plus the bulk transfer) must finish within this.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const INTERRUPT_WRITE_TIMEOUT: Duration = Duration::from_secs(3);
const BULK_WRITE_TIMEOUT: Duration = Duration::from_secs(15);

fn woke_from_sleep(prev: SystemTime, now: SystemTime) -> bool {
    now.duration_since(prev).is_ok_and(|gap| gap > RESUME_GAP)
}

/// Minimum wait before the next upload attempt after `failures` consecutive failures.
fn push_backoff(failures: u32) -> Duration {
    if failures == 0 {
        return Duration::ZERO;
    }
    Duration::from_millis(500u64 << failures.min(5)).min(Duration::from_secs(10))
}

#[derive(Debug, PartialEq, Eq)]
enum PollAction {
    LinkLost,
    ClearHalt,
    Retry(Duration),
}

/// What the interrupt poller should do after a failed transfer (`consecutive` counts this one).
fn classify_poll_error(err: TransferError, consecutive: u32) -> PollAction {
    match err {
        TransferError::Disconnected => PollAction::LinkLost,
        _ if consecutive >= MAX_POLL_ERRORS => PollAction::LinkLost,
        TransferError::Stall => PollAction::ClearHalt,
        _ => PollAction::Retry(Duration::from_millis(50 * consecutive as u64).min(Duration::from_millis(500))),
    }
}

#[derive(Debug, PartialEq, Eq)]
enum PollEnd {
    /// We asked it to stop (disconnect, or the receiver went away).
    Shutdown,
    /// The device stopped answering: unplugged, reset or re-enumerated (e.g. after suspend).
    LinkLost,
}

#[derive(Debug)]
struct UploadTimeout;

impl std::fmt::Display for UploadTimeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LCD upload timed out")
    }
}

impl std::error::Error for UploadTimeout {}

enum Push {
    Sent,
    Failed,
    /// The upload hung rather than failing; the device is not coming back without a reconnect.
    Wedged,
    /// The loop was replaced while we waited for the device.
    Stale,
}

// ============================================================================
// Driver
// ============================================================================
pub type StatusCallback = Arc<dyn Fn(&DeviceStatus) + Send + Sync>;
pub type TempsCallback = Arc<dyn Fn(&Temperatures) + Send + Sync>;
pub type RenderFn = dyn Fn(&DisplayConfig, Temperatures) -> Result<crate::render::LcdFrame> + Send + Sync;

struct Inner {
    status: RwLock<DeviceStatus>,
    display_config: RwLock<DisplayConfig>,
    config_version: AtomicU32,

    /// Bumped on every successful connect so late reports about an old connection can be ignored.
    conn_id: AtomicU32,

    temp_loop_active: AtomicBool,
    temp_gen: AtomicU32,
    temp_poll_ms: AtomicU64,
    temp_min_push_ms: AtomicU64,

    /// When false, skip emitting IPC events to the webview (window hidden).
    window_visible: AtomicBool,

    /// Hardware state — async mutex because operations span awaits.
    hw: AsyncMutex<Option<Hardware>>,

    /// External callbacks (set by the Tauri commands layer at startup).
    on_status_change: PlMutex<Option<StatusCallback>>,
    on_temps_update: PlMutex<Option<TempsCallback>>,
}

#[derive(Clone)]
pub struct KrakenDriver(Arc<Inner>);

impl KrakenDriver {
    pub fn new() -> Self {
        Self(Arc::new(Inner {
            status: RwLock::new(DeviceStatus::disconnected()),
            display_config: RwLock::new(DisplayConfig::default()),
            config_version: AtomicU32::new(0),
            conn_id: AtomicU32::new(0),
            temp_loop_active: AtomicBool::new(false),
            temp_gen: AtomicU32::new(0),
            temp_poll_ms: AtomicU64::new(500),
            temp_min_push_ms: AtomicU64::new(200),
            window_visible: AtomicBool::new(true),
            hw: AsyncMutex::new(None),
            on_status_change: PlMutex::new(None),
            on_temps_update: PlMutex::new(None),
        }))
    }

    pub fn set_status_callback(&self, cb: StatusCallback) {
        *self.0.on_status_change.lock() = Some(cb);
    }

    pub fn set_temps_callback(&self, cb: TempsCallback) {
        *self.0.on_temps_update.lock() = Some(cb);
    }

    pub fn get_status(&self) -> DeviceStatus {
        self.0.status.read().clone()
    }

    pub fn get_display_config(&self) -> DisplayConfig {
        self.0.display_config.read().clone()
    }

    pub fn set_display_config(&self, cfg: DisplayConfig) {
        *self.0.display_config.write() = cfg;
        self.0.config_version.fetch_add(1, Ordering::Release);
    }

    pub fn set_window_visible(&self, visible: bool) {
        self.0.window_visible.store(visible, Ordering::Relaxed);
    }

    pub fn set_temp_timing(&self, poll_ms: u64, min_push_ms: u64) {
        self.0
            .temp_poll_ms
            .store(poll_ms.clamp(50, 60_000), Ordering::Relaxed);
        self.0
            .temp_min_push_ms
            .store(min_push_ms.clamp(0, 10_000), Ordering::Relaxed);
    }

    fn emit_status(&self, status: &DeviceStatus) {
        if let Some(cb) = self.0.on_status_change.lock().clone() {
            cb(status);
        }
    }

    fn update_status(&self, mutate: impl FnOnce(&mut DeviceStatus)) {
        let mut s = self.0.status.write();
        mutate(&mut s);
        let snap = s.clone();
        drop(s);
        self.emit_status(&snap);
    }

    // ========================================================================
    // Connect / disconnect
    // ========================================================================

    pub async fn connect(&self) -> Result<()> {
        let mut hw_guard = self.0.hw.lock().await;
        if let Some(old) = hw_guard.as_mut() {
            if self.0.status.read().connected && old.alive.load(Ordering::Acquire) {
                return Ok(());
            }
            // Handles left over from a lost link (suspend/resume, replug): release them before reopening.
            if let Some(sd) = old.poll_shutdown.take() {
                let _ = sd.send(());
            }
            *hw_guard = None;
        }

        // Find a Kraken device by VID + any known PID.
        let devices = nusb::list_devices()
            .await
            .map_err(|e| anyhow!("list_devices: {e}"))?;
        let info = devices
            .into_iter()
            .find(|d| d.vendor_id() == NZXT_VID && KRAKEN_PIDS.contains(&d.product_id()))
            .ok_or_else(|| anyhow!("No Kraken Elite found"))?;
        let pid = info.product_id();

        let device = info.open().await.map_err(|e| anyhow!("Open USB: {e}"))?;
        log::debug!("Device: 0x{:04x}", pid);

        // Claim interfaces — detach kernel driver first.
        let iface0 = device
            .detach_and_claim_interface(IFACE_BULK)
            .await
            .map_err(|e| anyhow!("Claim iface0: {e}"))?;
        let iface1 = device
            .detach_and_claim_interface(IFACE_INTERRUPT)
            .await
            .map_err(|e| anyhow!("Claim iface1: {e}"))?;

        // Open endpoints. NZXT Kraken Elite layout: bulk OUT 0x02, intr OUT 0x01, intr IN 0x81.
        let bulk_out = iface0
            .endpoint::<Bulk, Out>(BULK_OUT_EP)
            .map_err(|e| anyhow!("Open bulk OUT {:#x}: {e}", BULK_OUT_EP))?;
        let intr_out = iface1
            .endpoint::<Interrupt, Out>(INTR_OUT_EP)
            .map_err(|e| anyhow!("Open intr OUT {:#x}: {e}", INTR_OUT_EP))?;
        let intr_in = iface1
            .endpoint::<Interrupt, In>(INTR_IN_EP)
            .map_err(|e| anyhow!("Open intr IN {:#x}: {e}", INTR_IN_EP))?;

        let in_packet_size = intr_in.max_packet_size();

        // Start the interrupt-in polling task.
        let (intr_tx, intr_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let conn_id = self.0.conn_id.fetch_add(1, Ordering::AcqRel) + 1;
        let alive = Arc::new(AtomicBool::new(true));
        let driver = self.clone();
        let poller_alive = alive.clone();
        tokio::spawn(async move {
            if poll_interrupt_in(intr_in, in_packet_size, intr_tx, shutdown_rx).await == PollEnd::LinkLost {
                poller_alive.store(false, Ordering::Release);
                driver.link_lost(conn_id);
            }
        });

        // Brief settle, then drain pre-existing packets.
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut hw = Hardware {
            _device: device,
            _iface0: iface0,
            _iface1: iface1,
            bulk_out,
            intr_out,
            poll_shutdown: Some(shutdown_tx),
            intr_rx,
            active_bucket: None,
            conn_id,
            alive,
        };
        drain_rx(&mut hw.intr_rx, Duration::from_millis(300)).await;
        hw.ensure_alive().map_err(|_| anyhow!("Kraken went away while connecting"))?;
        *hw_guard = Some(hw);

        self.update_status(|s| {
            *s = DeviceStatus {
                connected: true,
                product_name: product_name(pid).into(),
                pid: Some(pid),
                error: None,
                lcd_controllable: true,
            };
        });
        log::info!("Connecté ✓");
        Ok(())
    }

    pub async fn disconnect(&self) {
        self.stop_current_mode();
        let mut g = self.0.hw.lock().await;
        if let Some(mut hw) = g.take() {
            if let Some(sd) = hw.poll_shutdown.take() {
                let _ = sd.send(());
            }
            // Dropping Interface re-attaches the kernel driver automatically.
        }
        self.update_status(|s| *s = DeviceStatus::disconnected());
        crate::sensors::clear_device_temps();
    }

    /// The USB link died underneath us (the interrupt poller or an upload noticed). Report it right away,
    /// without waiting for the hardware lock, and let `watch_connection` bring the device back.
    /// The temperature loop keeps running and repaints once the device returns.
    fn link_lost(&self, conn_id: u32) {
        if self.0.conn_id.load(Ordering::Acquire) != conn_id || !self.0.status.read().connected {
            return;
        }
        log::warn!("USB link to the Kraken was lost (unplugged, or the system suspended); waiting for it to come back");
        self.update_status(|s| *s = DeviceStatus::disconnected());
        crate::sensors::clear_device_temps();
        let driver = self.clone();
        tokio::spawn(async move { driver.drop_hardware(conn_id).await });
    }

    async fn drop_hardware(&self, conn_id: u32) {
        let mut g = self.0.hw.lock().await;
        if g.as_ref().is_some_and(|hw| hw.conn_id == conn_id) {
            if let Some(mut hw) = g.take() {
                if let Some(sd) = hw.poll_shutdown.take() {
                    let _ = sd.send(());
                }
            }
        }
    }

    /// Keep the connection alive for the life of the app: reconnect whenever the device is missing
    /// (unplug, or re-enumeration after suspend) and repaint the LCD after the machine wakes up.
    pub async fn watch_connection(self) {
        let mut tick = tokio::time::interval(WATCH_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last_wall = SystemTime::now();
        let mut last_error: Option<String> = None;
        loop {
            tick.tick().await;
            let now = SystemTime::now();
            if woke_from_sleep(last_wall, now) {
                log::info!("System resumed from sleep; refreshing the LCD");
                self.refresh_display();
            }
            last_wall = now;

            if self.0.status.read().connected {
                last_error = None;
                continue;
            }
            match self.connect().await {
                Ok(()) => {
                    log::info!("Kraken connected");
                    last_error = None;
                }
                Err(e) => {
                    // Log a given failure once, not every few seconds.
                    let msg = e.to_string();
                    if last_error.as_deref() != Some(msg.as_str()) {
                        log::info!("Kraken not available: {msg}");
                        last_error = Some(msg);
                    }
                }
            }
        }
    }

    pub fn stop_current_mode(&self) {
        self.0.temp_loop_active.store(false, Ordering::Release);
        self.0.temp_gen.fetch_add(1, Ordering::Release);
    }

    /// Send pump speed profile to the Kraken firmware.
    /// `points` is a list of (temp_celsius, duty_percent) pairs from the UI curve.
    /// The firmware expects 40 duty values for temps 20°C..=59°C interpolated linearly.
    pub async fn set_pump_speed_profile(&self, points: Vec<(u8, u8)>) -> Result<()> {
        let mut hw_guard = self.0.hw.lock().await;
        let hw = hw_guard.as_mut().ok_or_else(|| anyhow!("Not connected"))?;

        // Interpolate duty for each integer temp 20..=59 (40 values).
        let mut duties = [20u8; 40];
        for (i, temp) in (20u8..=59u8).enumerate() {
            duties[i] = interp_duty(&points, temp).clamp(20, 100);
        }

        // Packet: [0x72, 0x01, 0x00, 0x00, d0..d39] padded to 64 bytes.
        let mut pkt = vec![0u8; 64];
        pkt[0] = 0x72;
        pkt[1] = 0x01;
        pkt[2] = 0x00;
        pkt[3] = 0x00;
        pkt[4..44].copy_from_slice(&duties);

        hw.ensure_alive()?;
        hw.intr_out.submit(Buffer::from(pkt));
        finish(&mut hw.intr_out, "pump profile write", INTERRUPT_WRITE_TIMEOUT).await?;
        log::info!("Pump speed profile envoyé ({} points)", points.len());
        Ok(())
    }

    /// Force the temperature loop to re-render on its next tick.
    pub fn refresh_display(&self) {
        self.0.config_version.fetch_add(1, Ordering::Release);
    }

    // ========================================================================
    // Public actions
    // ========================================================================

    pub async fn send_color(&self, r: u8, g: u8, b: u8) -> Result<()> {
        self.stop_current_mode();
        let pixels = (LCD_WIDTH * LCD_HEIGHT) as usize;
        let mut rgba = vec![0u8; pixels * 4];
        for i in 0..pixels {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = 0x00;
        }
        let bulk_info = bulk_info_rgba(rgba.len() as u32);
        let mut g = self.0.hw.lock().await;
        let hw = g.as_mut().ok_or_else(|| anyhow!("Not connected"))?;
        send_data_native(hw, &rgba, &bulk_info).await
    }

    pub async fn send_rgba_image(&self, rgba: Vec<u8>) -> Result<()> {
        self.stop_current_mode();
        let rgba = crate::image_io::rotate_for_lcd(rgba);
        let bulk_info = bulk_info_rgba(rgba.len() as u32);
        let mut g = self.0.hw.lock().await;
        let hw = g.as_mut().ok_or_else(|| anyhow!("Not connected"))?;
        send_data_native(hw, &rgba, &bulk_info).await
    }

    pub async fn send_gif(&self, gif_bytes: Vec<u8>) -> Result<()> {
        self.stop_current_mode();
        let bulk_info = bulk_info_gif(gif_bytes.len() as u32);
        let mut g = self.0.hw.lock().await;
        let hw = g.as_mut().ok_or_else(|| anyhow!("Not connected"))?;
        send_data_native(hw, &gif_bytes, &bulk_info).await
    }

    // ========================================================================
    // Ring LED lighting
    // ========================================================================

    pub async fn send_ring_lighting(
        &self,
        channel: crate::types::RingChannel,
        mode: crate::types::RingMode,
    ) -> Result<()> {
        let mut g = self.0.hw.lock().await;
        let hw = g.as_mut().ok_or_else(|| anyhow!("Not connected"))?;
        let cmd = build_ring_cmd(channel, mode);
        write_cmd(hw, &cmd).await
    }

    // ========================================================================
    // Temperature mode — internal animation loop
    // ========================================================================

    pub fn start_temp_mode<F>(&self, render_fn: F) -> Result<()>
    where
        F: Fn(&DisplayConfig, Temperatures) -> Result<crate::render::LcdFrame> + Send + Sync + 'static,
    {
        self.stop_current_mode();
        let my_gen = self.0.temp_gen.load(Ordering::Acquire);
        self.0.temp_loop_active.store(true, Ordering::Release);

        let driver = self.clone();
        let render = Arc::new(render_fn);
        tokio::spawn(async move {
            driver.temp_loop(my_gen, render).await;
        });
        Ok(())
    }

    async fn temp_loop(
        &self,
        my_gen: u32,
        render_fn: Arc<RenderFn>,
    ) {
        let mut last_visual_key: Option<String> = None;
        let mut last_push_at: Option<Instant> = None;
        let mut gif_cost = Duration::from_secs(1);
        let mut failures = 0u32;
        // Extra wait after a render error, so a persistent one (missing font or image) doesn't re-render every tick.
        let mut render_retry = Duration::ZERO;
        let mut seen_conn = self.0.conn_id.load(Ordering::Acquire);

        loop {
            if !self.0.temp_loop_active.load(Ordering::Acquire)
                || self.0.temp_gen.load(Ordering::Acquire) != my_gen
            {
                break;
            }

            let tick_start = Instant::now();
            let temps = crate::sensors::read_temperatures();

            // Only push IPC events when the window is actually visible.
            if self.0.window_visible.load(Ordering::Relaxed) {
                if let Some(cb) = self.0.on_temps_update.lock().clone() {
                    cb(&temps);
                }
            }

            // Without a device there is nothing to draw on. A new connection (after replug or resume)
            // has lost whatever the LCD showed, so the next frame must be pushed even if nothing changed.
            let conn_id = self.0.conn_id.load(Ordering::Acquire);
            let connected = self.0.status.read().connected;
            if !connected || conn_id != seen_conn {
                last_visual_key = None;
                last_push_at = None;
                failures = 0;
                seen_conn = conn_id;
            }

            if connected {
                let cfg_snapshot = self.0.display_config.read().clone();
                let decimals = cfg_snapshot.decimals.min(2);
                let config_version = self.0.config_version.load(Ordering::Acquire);
                let key = visual_key(&cfg_snapshot, temps, decimals, config_version);

                let min_push = Duration::from_millis(self.0.temp_min_push_ms.load(Ordering::Relaxed));
                // A GIF background is re-encoded per update; keep that under ~20% of a core (1-5s between updates).
                let min_push = if crate::render::has_gif_background(&cfg_snapshot) {
                    min_push.max((gif_cost * 5).clamp(Duration::from_secs(1), Duration::from_secs(5)))
                } else {
                    min_push
                };
                let min_push = min_push.max(push_backoff(failures)).max(render_retry);
                let cooldown_ok = last_push_at.is_none_or(|t| t.elapsed() >= min_push);

                if Some(&key) != last_visual_key.as_ref() && cooldown_ok {
                    let render_start = Instant::now();
                    let rendered = render_fn(&cfg_snapshot, temps);
                    if matches!(rendered, Ok(crate::render::LcdFrame::Gif(_))) {
                        gif_cost = render_start.elapsed();
                    }
                    match rendered {
                        Ok(frame) => {
                            render_retry = Duration::ZERO;
                            let (data, bulk_info) = match frame {
                                crate::render::LcdFrame::Rgba(rgba) => {
                                    let rgba = crate::image_io::rotate_for_lcd(rgba);
                                    let info = bulk_info_rgba(rgba.len() as u32);
                                    (rgba, info)
                                }
                                crate::render::LcdFrame::Gif(gif) => {
                                    let info = bulk_info_gif(gif.len() as u32);
                                    (gif, info)
                                }
                            };
                            match self.push_frame(my_gen, &data, &bulk_info).await {
                                Push::Sent => {
                                    last_visual_key = Some(key);
                                    last_push_at = Some(Instant::now());
                                    failures = 0;
                                }
                                Push::Stale => {}
                                Push::Failed => {
                                    failures += 1;
                                    last_push_at = Some(Instant::now());
                                    if failures >= MAX_PUSH_FAILURES {
                                        self.link_lost(conn_id);
                                    }
                                }
                                Push::Wedged => self.link_lost(conn_id),
                            }
                        }
                        Err(e) => {
                            log::warn!("render error: {e}");
                            render_retry = Duration::from_secs(5);
                            last_push_at = Some(Instant::now());
                        }
                    }
                }
            }

            // Sleep — interruptible-friendly (small slices).
            let elapsed = tick_start.elapsed();
            let target = Duration::from_millis(self.0.temp_poll_ms.load(Ordering::Relaxed));
            let remaining = target.checked_sub(elapsed).unwrap_or(Duration::ZERO);
            let mut left = remaining;
            while !left.is_zero() {
                if !self.0.temp_loop_active.load(Ordering::Acquire)
                    || self.0.temp_gen.load(Ordering::Acquire) != my_gen
                {
                    return;
                }
                let slice = left.min(Duration::from_millis(50));
                tokio::time::sleep(slice).await;
                left = left.checked_sub(slice).unwrap_or(Duration::ZERO);
            }
        }
        log::debug!("temp loop {} terminé", my_gen);
    }

    async fn push_frame(&self, my_gen: u32, data: &[u8], bulk_info: &[u8]) -> Push {
        let mut g = self.0.hw.lock().await;
        let Some(hw) = g.as_mut() else {
            return Push::Failed;
        };
        if !self.0.temp_loop_active.load(Ordering::Acquire) || self.0.temp_gen.load(Ordering::Acquire) != my_gen {
            return Push::Stale;
        }
        match send_data_native(hw, data, bulk_info).await {
            Ok(()) => Push::Sent,
            Err(e) if e.downcast_ref::<UploadTimeout>().is_some() => {
                log::warn!("temp push hung: {e}");
                Push::Wedged
            }
            Err(e) => {
                log::warn!("temp push failed: {e}");
                Push::Failed
            }
        }
    }
}

impl Default for KrakenDriver {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Visual key — stable representation of what the LCD will display
// ============================================================================
/// Only what is actually drawn, so off-screen readings (e.g. pump RPM) don't trigger a bucket switch.
fn visual_key(cfg: &DisplayConfig, t: Temperatures, decimals: u8, config_version: u32) -> String {
    use crate::types::{format_metric, resolve_text, DisplayElement};
    let mut key = config_version.to_string();
    for el in &cfg.elements {
        key.push('|');
        match el {
            DisplayElement::Gauge(g) => key.push_str(&format_metric(g.metric.value_from(t), decimals)),
            DisplayElement::Bar(b) => key.push_str(&format_metric(b.metric.value_from(t), decimals)),
            // A graph scrolls with every new history sample, not only when its number changes.
            DisplayElement::Graph(g) => {
                key.push_str(&format_metric(g.metric.value_from(t), decimals));
                key.push(':');
                key.push_str(&crate::sensors::history::version().to_string());
            }
            DisplayElement::Text(x) => key.push_str(&resolve_text(&x.text, t, decimals)),
            // Pictures only change with the config itself, which `config_version` already covers.
            DisplayElement::Image(_) => {}
        }
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{TextAlign, TextElement};

    #[test]
    fn visual_key_ignores_offscreen_readings() {
        let text = TextElement { id: "t".into(), x: 0.0, y: 0.0, text: "{liquid}°".into(), color: "#fff".into(), size: 10.0, align: TextAlign::Center, font: None };
        let cfg = DisplayConfig { elements: vec![crate::types::DisplayElement::Text(text)], ..DisplayConfig::default() };
        let base = Temperatures { liquid: 31.2, pump_rpm: 1500.0, ..Temperatures::default() };
        let key = |t| visual_key(&cfg, t, 0, 1);
        assert_eq!(key(base), key(Temperatures { pump_rpm: 1620.0, cpu: 70.0, ..base }));
        assert_eq!(key(base), key(Temperatures { liquid: 31.4, ..base }), "same at 0 decimals");
        assert_ne!(key(base), key(Temperatures { liquid: 32.0, ..base }));
    }

    #[test]
    fn dead_links_stop_the_poller_instead_of_spinning() {
        use std::time::Duration;
        assert_eq!(classify_poll_error(TransferError::Disconnected, 1), PollAction::LinkLost);
        assert_eq!(classify_poll_error(TransferError::Stall, 1), PollAction::ClearHalt);
        assert!(matches!(classify_poll_error(TransferError::Fault, 1), PollAction::Retry(d) if d > Duration::ZERO));
        // Whatever the error, it gives up after enough in a row.
        for err in [TransferError::Fault, TransferError::Stall, TransferError::Unknown(5)] {
            assert_eq!(classify_poll_error(err, MAX_POLL_ERRORS), PollAction::LinkLost);
        }
        // Retries back off but stay bounded.
        let PollAction::Retry(late) = classify_poll_error(TransferError::Fault, MAX_POLL_ERRORS - 1) else { panic!() };
        assert!(late <= Duration::from_millis(500));
    }

    #[test]
    fn failed_uploads_back_off_and_cap() {
        use std::time::Duration;
        assert_eq!(push_backoff(0), Duration::ZERO);
        assert!(push_backoff(1) < push_backoff(2) && push_backoff(2) < push_backoff(3));
        assert_eq!(push_backoff(40), Duration::from_secs(10));
    }

    #[test]
    fn long_wall_clock_gaps_mean_the_machine_slept() {
        use std::time::{Duration, SystemTime};
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(!woke_from_sleep(t, t + WATCH_EVERY));
        assert!(woke_from_sleep(t, t + Duration::from_secs(3600)));
        assert!(!woke_from_sleep(t, t - Duration::from_secs(60)), "clock stepping backwards is not a resume");
    }

    #[tokio::test]
    async fn connection_watcher_can_be_spawned_on_the_runtime() {
        // lib.rs hands this future to `tauri::async_runtime::spawn`, which requires it to be Send.
        tokio::spawn(KrakenDriver::new().watch_connection()).abort();
    }

    fn connected_driver() -> KrakenDriver {
        let d = KrakenDriver::new();
        d.update_status(|s| s.connected = true);
        d
    }

    #[tokio::test]
    async fn link_loss_marks_the_device_disconnected_once_and_ignores_stale_reports() {
        let d = connected_driver();
        d.0.conn_id.store(5, Ordering::Release);
        d.link_lost(4); // a report about an older connection
        assert!(d.get_status().connected);
        d.link_lost(5);
        assert!(!d.get_status().connected);
        d.link_lost(5); // already handled
        assert!(!d.get_status().connected);
    }

    #[tokio::test]
    async fn temp_loop_does_not_render_while_the_device_is_missing() {
        let d = KrakenDriver::new(); // never connected
        d.set_temp_timing(50, 0);
        let renders = Arc::new(AtomicU32::new(0));
        let counter = renders.clone();
        d.start_temp_mode(move |_, _| {
            counter.fetch_add(1, Ordering::Relaxed);
            Ok(crate::render::LcdFrame::Rgba(Vec::new()))
        })
        .unwrap();
        tokio::time::sleep(Duration::from_millis(700)).await;
        d.stop_current_mode();
        assert_eq!(renders.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn failing_uploads_back_off_then_declare_the_link_lost() {
        // Status says connected but there are no handles, so every upload fails.
        let d = connected_driver();
        d.set_temp_timing(50, 0);
        let renders = Arc::new(AtomicU32::new(0));
        let counter = renders.clone();
        d.start_temp_mode(move |_, _| {
            counter.fetch_add(1, Ordering::Relaxed);
            Ok(crate::render::LcdFrame::Rgba(vec![0; (LCD_WIDTH * LCD_HEIGHT * 4) as usize]))
        })
        .unwrap();
        for _ in 0..100 {
            if !d.get_status().connected {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        d.stop_current_mode();
        assert!(!d.get_status().connected, "gave up on the link after repeated failures");
        assert_eq!(renders.load(Ordering::Relaxed), MAX_PUSH_FAILURES, "one render per attempt, no storm");
    }
}
