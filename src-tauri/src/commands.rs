//! Tauri commands — bridges the React UI to the Rust backend.
//!
//! Mirrors ipc-handlers.ts from the Electron app. All commands return
//! `Result<T, String>` so the frontend can surface errors cleanly.

use crate::config;
use crate::image_io;
use crate::profile::{self, Profile, ProfileLcd, ProfileSummary};
use crate::render;
use crate::sensors;
use crate::types::{
    AppSettings, DeviceStatus, DisplayConfig, GpuSource, RingChannel, RingMode, Temperatures,
};
use crate::usb::KrakenDriver;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use tokio::time::{interval, Duration};

// ============================================================================
// Shared state
// ============================================================================

pub struct AppState {
    pub driver: KrakenDriver,
    pub gpu_fan: crate::fans::GpuFanController,
    /// Optional shutdown signal for the periodic temp-polling task.
    pub temp_poll_shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CommandResult {
    fn ok() -> Self {
        Self { success: true, error: None }
    }
    fn fail(e: impl ToString) -> Self {
        Self {
            success: false,
            error: Some(e.to_string()),
        }
    }
}

fn to_str_err<E: ToString>(e: E) -> String {
    e.to_string()
}

// ============================================================================
// Connection
// ============================================================================

#[tauri::command]
pub async fn connect_device(state: State<'_, AppState>) -> Result<CommandResult, String> {
    match state.driver.connect().await {
        Ok(_) => Ok(CommandResult::ok()),
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub fn get_device_status(state: State<'_, AppState>) -> DeviceStatus {
    state.driver.get_status()
}

// ============================================================================
// Modes (color / image / gif / temperatures)
// ============================================================================

#[tauri::command]
pub async fn send_color(
    r: u8,
    g: u8,
    b: u8,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    match state.driver.send_color(r, g, b).await {
        Ok(_) => {
            let _ = config::update(|c| {
                c.last_mode = Some("color".into());
                c.last_color = Some(config::LastColor { r, g, b });
            });
            Ok(CommandResult::ok())
        }
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub async fn send_image(path: String, state: State<'_, AppState>) -> Result<CommandResult, String> {
    let bytes = image_io::read_image_file_async(&path)
        .await
        .map_err(to_str_err)?;
    let rgba = match image_io::image_to_device_rgba(&bytes) {
        Ok(b) => b,
        Err(e) => return Ok(CommandResult::fail(e)),
    };
    match state.driver.send_rgba_image(rgba).await {
        Ok(_) => {
            let _ = config::update(|c| {
                c.last_mode = Some("image".into());
                c.last_image_path = Some(path);
            });
            Ok(CommandResult::ok())
        }
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub async fn send_gif(path: String, state: State<'_, AppState>) -> Result<CommandResult, String> {
    let bytes = image_io::read_image_file_async(&path)
        .await
        .map_err(to_str_err)?;
    // Resize GIF in a blocking task — image decoding can be heavy.
    let resized = match tokio::task::spawn_blocking(move || image_io::resize_gif(&bytes)).await {
        Ok(Ok(b)) => b,
        Ok(Err(e)) => return Ok(CommandResult::fail(e)),
        Err(e) => return Ok(CommandResult::fail(e)),
    };
    match state.driver.send_gif(resized).await {
        Ok(_) => {
            let _ = config::update(|c| {
                c.last_mode = Some("gif".into());
                c.last_gif_path = Some(path);
            });
            Ok(CommandResult::ok())
        }
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub async fn start_temp_mode(state: State<'_, AppState>) -> Result<CommandResult, String> {
    let result = state
        .driver
        .start_temp_mode(render::render_for_device);
    let _ = config::update(|c| c.last_mode = Some("temperatures".into()));
    match result {
        Ok(_) => Ok(CommandResult::ok()),
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub fn stop_current_mode(state: State<'_, AppState>) -> CommandResult {
    state.driver.stop_current_mode();
    CommandResult::ok()
}

// ============================================================================
// Temperatures (UI polling)
// ============================================================================

#[tauri::command]
pub fn get_temperatures() -> Temperatures {
    sensors::read_temperatures()
}

#[tauri::command]
pub async fn start_temp_polling(
    interval_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let fallback = config::load_settings().poll_interval_ms;
    let ms = interval_ms.unwrap_or(fallback).clamp(100, 60_000);

    // Cancel previous polling task if any.
    if let Some(prev) = state.temp_poll_shutdown.lock().take() {
        let _ = prev.send(());
    }

    let (tx, mut rx) = oneshot::channel::<()>();
    *state.temp_poll_shutdown.lock() = Some(tx);

    let app_clone = app.clone();
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_millis(ms));
        // Skip the immediate first tick to match Electron's setInterval semantics.
        tick.tick().await;
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tick.tick() => {
                    let temps = sensors::read_temperatures();
                    let _ = app_clone.emit("temperatures-update", temps);
                }
            }
        }
    });
    Ok(CommandResult::ok())
}

#[tauri::command]
pub fn stop_temp_polling(state: State<'_, AppState>) -> CommandResult {
    if let Some(prev) = state.temp_poll_shutdown.lock().take() {
        let _ = prev.send(());
    }
    CommandResult::ok()
}

// ============================================================================
// Display config / preview
// ============================================================================

#[tauri::command]
pub fn get_display_config(state: State<'_, AppState>) -> DisplayConfig {
    state.driver.get_display_config()
}

#[tauri::command]
pub fn save_display_config(
    config_in: DisplayConfig,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    state.driver.set_display_config(config_in.clone());
    let _ = config::update(|c| c.display_config = Some(config_in));
    Ok(CommandResult::ok())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn render_display_preview(config_in: DisplayConfig) -> PreviewResult {
    let temps = sensors::read_temperatures();
    match render::render_preview_png(&config_in, temps) {
        Ok(png) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
            PreviewResult {
                success: true,
                data_url: Some(format!("data:image/png;base64,{}", b64)),
                error: None,
            }
        }
        Err(e) => PreviewResult {
            success: false,
            data_url: None,
            error: Some(e.to_string()),
        },
    }
}

/// Installed font families the LCD renderer can use.
#[tauri::command]
pub async fn list_fonts() -> Vec<render::fonts::FontEntry> {
    tokio::task::spawn_blocking(render::fonts::font_entries).await.unwrap_or_default()
}

// ============================================================================
// Settings
// ============================================================================

#[tauri::command]
pub fn list_gpu_sources() -> Vec<GpuSource> {
    sensors::gpu::list_gpu_sources(true)
}

const MAX_GIPHY_BYTES: usize = 32 * 1024 * 1024;

/// Store a GIF downloaded from GIPHY (raw IPC body, id in the `x-giphy-id` header) and return its path.
#[tauri::command]
pub fn save_giphy_gif(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let id = request.headers().get("x-giphy-id").and_then(|v| v.to_str().ok()).unwrap_or_default();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw GIF bytes".into());
    };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid GIPHY id".into());
    }
    if !bytes.starts_with(b"GIF8") {
        return Err("Download is not a GIF".into());
    }
    if bytes.len() > MAX_GIPHY_BYTES {
        return Err(format!("GIF is larger than {MAX_GIPHY_BYTES} bytes"));
    }
    let dir = dirs::cache_dir().ok_or("Cache dir not found")?.join("nzxtcam-archlinux-rust/giphy");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id}.gif"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn start_visible() -> bool {
    crate::cli::START_VISIBLE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Off the UI thread: listing may query nvidia-smi and a Home Assistant server.
#[tauri::command]
pub async fn list_sensors() -> Result<Vec<sensors::all::Sensor>, String> {
    tauri::async_runtime::spawn_blocking(sensors::all::list_sensors).await.map_err(|e| e.to_string())
}

/// Logos found on this machine for the Logo picker; the scan runs off the UI thread.
#[tauri::command]
pub async fn list_system_logos() -> Result<Vec<crate::logos::SystemLogo>, String> {
    tauri::async_runtime::spawn_blocking(crate::logos::discover).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings() -> AppSettings {
    config::load_settings()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsResult {
    pub success: bool,
    pub settings: AppSettings,
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<SaveSettingsResult, String> {
    let previous = config::load_settings();
    let mut merged = settings;
    merged.clamp();

    // Apply runtime changes.
    sensors::set_gpu_source(merged.gpu_source.clone());
    sensors::set_sensor_sources(merged.cpu_source.clone(), merged.sensor_sources());
    if merged.home_assistant_url != previous.home_assistant_url || merged.api_keys.get("homeassistant") != previous.api_keys.get("homeassistant") {
        merged.apply_home_assistant();
    }
    state
        .driver
        .set_temp_timing(merged.lcd_poll_ms, merged.lcd_min_push_ms);

    // If decimals changed, re-apply to the active display config.
    if merged.decimals != previous.decimals {
        let mut cfg = state.driver.get_display_config();
        cfg.decimals = merged.decimals;
        state.driver.set_display_config(cfg);
    }

    let s = merged.clone();
    let _ = config::update(|c| c.settings = Some(s));

    Ok(SaveSettingsResult { success: true, settings: merged })
}

// ============================================================================
// Profiles
// ============================================================================

#[tauri::command]
pub fn list_profiles() -> Vec<ProfileSummary> {
    profile::list_profiles()
}

#[tauri::command]
pub fn save_profile_cmd(p: Profile) -> Result<CommandResult, String> {
    profile::save_profile(&p).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok())
}

#[tauri::command]
pub fn delete_profile_cmd(name: String) -> Result<CommandResult, String> {
    profile::delete_profile(&name).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok())
}

#[tauri::command]
pub fn get_profile(name: String) -> Result<Profile, String> {
    profile::load_profile(&name).map_err(|e| e.to_string())
}

// ---- Saved layouts (named DisplayConfigs) ----

#[tauri::command]
pub fn list_layouts() -> Vec<crate::layouts::SavedLayout> {
    crate::layouts::list_layouts()
}

#[tauri::command]
pub fn save_layout(name: String, config_in: DisplayConfig) -> Result<CommandResult, String> {
    crate::layouts::save_layout(&name, config_in).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok())
}

#[tauri::command]
pub fn delete_layout(name: String) -> Result<CommandResult, String> {
    crate::layouts::delete_layout(&name).map_err(|e| e.to_string())?;
    Ok(CommandResult::ok())
}

#[tauri::command]
pub fn get_layout(name: String) -> Result<crate::layouts::SavedLayout, String> {
    crate::layouts::load_layout(&name).map_err(|e| e.to_string())
}

/// Write all saved layouts to one JSON file; returns how many.
#[tauri::command]
pub fn export_layouts(path: String) -> Result<usize, String> {
    crate::layouts::export_all(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

/// Import layouts from a file written by `export_layouts`; returns how many.
#[tauri::command]
pub fn import_layouts(path: String) -> Result<usize, String> {
    crate::layouts::import_all(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

/// Apply a saved profile: LCD + ring.
#[tauri::command]
pub async fn apply_profile(
    name: String,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let p = profile::load_profile(&name).map_err(|e| e.to_string())?;
    apply_profile_inner(&p, &state).await
}

pub async fn apply_profile_inner(p: &Profile, state: &AppState) -> Result<CommandResult, String> {
    // Apply ring first (non-blocking, best-effort)
    if let Some(ref ring) = p.ring {
        let _ = state.driver.send_ring_lighting(ring.channel, ring.mode.clone()).await;
    }

    // Apply LCD mode
    match &p.lcd {
        ProfileLcd::None => {}
        ProfileLcd::Color { r, g, b } => {
            let (r, g, b) = (*r, *g, *b);
            match state.driver.send_color(r, g, b).await {
                Ok(_) => { let _ = config::update(|c| { c.last_mode = Some("color".into()); c.last_color = Some(config::LastColor { r, g, b }); }); }
                Err(e) => return Ok(CommandResult::fail(e)),
            }
        }
        ProfileLcd::Image { path } => {
            let bytes = image_io::read_image_file_async(path).await.map_err(to_str_err)?;
            let rgba = image_io::image_to_device_rgba(&bytes).map_err(|e| e.to_string())?;
            match state.driver.send_rgba_image(rgba).await {
                Ok(_) => { let _ = config::update(|c| { c.last_mode = Some("image".into()); c.last_image_path = Some(path.clone()); }); }
                Err(e) => return Ok(CommandResult::fail(e)),
            }
        }
        ProfileLcd::Gif { path } => {
            let bytes = image_io::read_image_file_async(path).await.map_err(to_str_err)?;
            let resized = tokio::task::spawn_blocking(move || image_io::resize_gif(&bytes))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            match state.driver.send_gif(resized).await {
                Ok(_) => { let _ = config::update(|c| { c.last_mode = Some("gif".into()); c.last_gif_path = Some(path.clone()); }); }
                Err(e) => return Ok(CommandResult::fail(e)),
            }
        }
        ProfileLcd::Temperatures => {
            let result = state.driver.start_temp_mode(render::render_for_device);
            let _ = config::update(|c| c.last_mode = Some("temperatures".into()));
            if let Err(e) = result { return Ok(CommandResult::fail(e)); }
        }
    }

    // Apply display config if present
    if let Some(ref dc) = p.display_config {
        state.driver.set_display_config(dc.clone());
    }

    Ok(CommandResult::ok())
}

// ============================================================================
// GPU fan control
// ============================================================================

#[tauri::command]
pub fn get_gpu_fan_status(state: State<'_, AppState>) -> Option<crate::fans::GpuFanStatus> {
    state.gpu_fan.get_status()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuFanCurvePoint { pub t: u8, pub s: u8 }

#[tauri::command]
pub fn set_gpu_fan_curve(points: Vec<GpuFanCurvePoint>, state: State<'_, AppState>) -> CommandResult {
    let pairs: Vec<(u8, u8)> = points.into_iter().map(|p| (p.t, p.s)).collect();
    match state.gpu_fan.set_curve(pairs) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

#[tauri::command]
pub fn set_gpu_fan_auto(state: State<'_, AppState>) -> CommandResult {
    match state.gpu_fan.set_auto() {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

// ============================================================================
// Fan control (hwmon sysfs — boitier)
// ============================================================================

#[tauri::command]
pub fn list_drives() -> Result<Vec<crate::storage::Drive>, String> {
    crate::storage::list_drives()
}

#[tauri::command]
pub fn list_fan_channels() -> Vec<crate::fans::FanChannel> {
    crate::fans::list_fan_channels()
}

#[tauri::command]
pub fn read_fan_channels() -> Vec<crate::fans::FanChannel> {
    crate::fans::list_fan_channels()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFanDutyArgs {
    pub hwmon_path: String,
    pub pwm_index: u8,
    pub duty: u8,
}

#[tauri::command]
pub fn set_fan_duty_cmd(args: SetFanDutyArgs) -> CommandResult {
    match crate::fans::set_fan_duty(&args.hwmon_path, args.pwm_index, args.duty) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFanAutoArgs {
    pub hwmon_path: String,
    pub pwm_index: u8,
}

#[tauri::command]
pub fn set_fan_auto_cmd(args: SetFanAutoArgs) -> CommandResult {
    match crate::fans::set_fan_auto(&args.hwmon_path, args.pwm_index) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

// ============================================================================
// Pump speed profile
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanPoint {
    pub t: u8,
    pub s: u8,
}

#[tauri::command]
pub async fn set_pump_profile(
    points: Vec<FanPoint>,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    let pairs: Vec<(u8, u8)> = points.into_iter().map(|p| (p.t, p.s)).collect();
    match state.driver.set_pump_speed_profile(pairs).await {
        Ok(_) => Ok(CommandResult::ok()),
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

#[tauri::command]
pub fn set_lcd_orientation(degrees: u16, state: State<'_, AppState>) -> Result<CommandResult, String> {
    image_io::set_lcd_rotation(degrees);
    config::update(|c| c.lcd_rotation = degrees).map_err(|e| e.to_string())?;
    state.driver.refresh_display();
    Ok(CommandResult::ok())
}

// ============================================================================
// Ring LED
// ============================================================================

#[tauri::command]
pub async fn send_ring(
    mode: RingMode,
    channel: RingChannel,
    state: State<'_, AppState>,
) -> Result<CommandResult, String> {
    match state.driver.send_ring_lighting(channel, mode).await {
        Ok(_) => Ok(CommandResult::ok()),
        Err(e) => Ok(CommandResult::fail(e)),
    }
}

// ============================================================================
// Misc
// ============================================================================

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn hide_window(app: AppHandle, state: State<'_, AppState>) {
    state.driver.set_window_visible(false);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("window-visibility", false);
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn show_window(app: AppHandle, state: State<'_, AppState>) {
    state.driver.set_window_visible(true);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.emit("window-visibility", true);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
pub fn open_external(url: String, app: AppHandle) -> CommandResult {
    use tauri_plugin_shell::ShellExt;
    if !url.starts_with("https://") {
        return CommandResult::fail("Only https:// links can be opened");
    }
    #[allow(deprecated)]
    match app.shell().open(&url, None) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

#[tauri::command]
pub fn get_config() -> config::ConfigFile {
    config::load()
}

// Autostart: systemd user service plus an XDG autostart entry for desktops that don't run `systemd --user`.

const SERVICE_NAME: &str = "nzxtcam-v1.service";

fn quote_exec_path(path: &str, escape: fn(char) -> Option<&'static str>) -> Result<String, String> {
    if path.contains(['\n', '\r']) {
        return Err("Binary path contains a line break".into());
    }
    let mut quoted = String::from("\"");
    for c in path.chars() {
        match escape(c) {
            Some(replacement) => quoted.push_str(replacement),
            None => quoted.push(c),
        }
    }
    quoted.push('"');
    Ok(quoted)
}

fn escape_for_systemd(c: char) -> Option<&'static str> {
    match c {
        '"' => Some("\\\""),
        '\\' => Some("\\\\"),
        '%' => Some("%%"),
        '$' => Some("$$"),
        _ => None,
    }
}

fn escape_for_desktop_entry(c: char) -> Option<&'static str> {
    match c {
        '"' => Some("\\\""),
        '`' => Some("\\`"),
        '$' => Some("\\$"),
        '\\' => Some("\\\\"),
        '%' => Some("%%"),
        _ => None,
    }
}

fn run_systemctl_user(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("systemctl: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!("systemctl --user {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim()))
}

#[tauri::command]
pub fn get_autostart() -> bool {
    let Some(home) = dirs::home_dir() else { return false };
    home.join(".config/systemd/user").join(SERVICE_NAME).exists()
        || home.join(".config/autostart/nzxtcam-v1.desktop").exists()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    let service_dir = home.join(".config/systemd/user");
    let service_path = service_dir.join(SERVICE_NAME);
    let xdg_dir = home.join(".config/autostart");
    let xdg_path = xdg_dir.join("nzxtcam-v1.desktop");

    if !enabled {
        let _ = run_systemctl_user(&["disable", SERVICE_NAME]);
        for path in [&service_path, &xdg_path] {
            match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("{}: {e}", path.display())),
                _ => {}
            }
        }
        return Ok(());
    }

    let exe = std::env::current_exe().map_err(to_str_err)?;
    let exe = exe.to_string_lossy();
    let systemd_exe = quote_exec_path(&exe, escape_for_systemd)?;
    let desktop_exe = quote_exec_path(&exe, escape_for_desktop_entry)?;

    std::fs::create_dir_all(&xdg_dir).map_err(to_str_err)?;
    std::fs::write(&xdg_path, format!(
        "[Desktop Entry]\nType=Application\nName=nzxtcam-v1\n\
         Exec={desktop_exe}\nIcon=nzxtcam-v1\nHidden=false\n\
         NoDisplay=false\nX-GNOME-Autostart-enabled=true\n"
    )).map_err(to_str_err)?;

    std::fs::create_dir_all(&service_dir).map_err(to_str_err)?;
    std::fs::write(&service_path, format!(
        "[Unit]\nDescription=NZXT CAM v1 — LCD Controller\nAfter=graphical-session.target\n\n\
         [Service]\nType=simple\nExecStart={systemd_exe}\nRestart=on-failure\nRestartSec=3\n\n\
         [Install]\nWantedBy=graphical-session.target\n"
    )).map_err(to_str_err)?;
    run_systemctl_user(&["daemon-reload"])?;
    run_systemctl_user(&["enable", SERVICE_NAME])
}


// ============================================================================
// Bootstrap helper — wired by `lib::run()`
// ============================================================================

pub fn setup_callbacks(app: &AppHandle, driver: &KrakenDriver) {
    let app_for_status = app.clone();
    driver.set_status_callback(Arc::new(move |status: &DeviceStatus| {
        let _ = app_for_status.emit("device-status-changed", status);
    }));

    let app_for_temps = app.clone();
    driver.set_temps_callback(Arc::new(move |temps: &Temperatures| {
        let _ = app_for_temps.emit("temperatures-update", temps);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_paths_are_quoted_and_escaped() {
        assert_eq!(quote_exec_path("/opt/my app/bin", escape_for_systemd).unwrap(), "\"/opt/my app/bin\"");
        assert_eq!(quote_exec_path("/a%b$c\"d", escape_for_systemd).unwrap(), "\"/a%%b$$c\\\"d\"");
        assert_eq!(quote_exec_path("/a`b$c", escape_for_desktop_entry).unwrap(), "\"/a\\`b\\$c\"");
        assert!(quote_exec_path("/a\nb", escape_for_systemd).is_err());
    }
}
