//! Fan control via Linux hwmon sysfs.

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

const HWMON_ROOT: &str = "/sys/class/hwmon/";
const MAX_PWM_INDEX: u8 = 8;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanChannel {
    pub id: String,
    pub label: String,
    pub hwmon_path: String,
    pub pwm_index: u8,
    pub rpm: u32,
    pub duty: u8,
    pub auto: bool,
    pub controllable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuFanStatus {
    pub hwmon_path: String,
    pub name: Option<String>,
    pub rpm: u32,
    pub duty: u8,
    pub gpu_temp: f32,
    pub controllable: bool,
}

// ── GPU fan controller (background loop) ─────────────────────────────────────

#[derive(Clone)]
pub struct GpuFanController(Arc<GpuFanInner>);

struct GpuFanInner {
    running: AtomicBool,
    // A superseded loop thread sees a newer generation and exits, so stop() + start() never leaves two writers.
    generation: AtomicU64,
    curve: Mutex<Option<Vec<(u8, u8)>>>, // None = auto
}

impl GpuFanController {
    pub fn new() -> Self {
        Self(Arc::new(GpuFanInner {
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            curve: Mutex::new(None),
        }))
    }

    /// Start background loop that applies the curve based on GPU temp.
    pub fn start(&self) {
        if self.0.running.swap(true, Ordering::SeqCst) { return; }
        let inner = self.0.clone();
        let generation = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            while inner.running.load(Ordering::Relaxed) && inner.generation.load(Ordering::Relaxed) == generation {
                let curve = inner.curve.lock().clone();
                if let Some(pts) = curve {
                    if let Some((hwmon, _)) = find_amdgpu_hwmon() {
                        apply_curve_tick(&hwmon, &pts);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(1500));
            }
        });
    }

    pub fn stop(&self) {
        self.0.running.store(false, Ordering::SeqCst);
    }

    /// Hand the fan back to the driver if a curve is driving it; call on app exit.
    pub fn release(&self) -> Result<()> {
        if self.0.curve.lock().is_none() {
            return Ok(());
        }
        self.set_auto()
    }

    /// Set a predefined or manual curve — starts the loop.
    pub fn set_curve(&self, pts: Vec<(u8, u8)>) -> Result<()> {
        if pts.is_empty() {
            return Err(anyhow!("Fan curve needs at least one point"));
        }
        let (hwmon, _) = find_amdgpu_hwmon().ok_or_else(|| anyhow!("AMD GPU not found"))?;
        // Switch to manual first
        fs::write(PathBuf::from(&hwmon).join("pwm1_enable"), b"1\n")
            .map_err(|e| anyhow!("pwm_enable: {e}"))?;
        *self.0.curve.lock() = Some(pts);
        self.start();
        Ok(())
    }

    /// Return GPU fan to automatic driver control.
    pub fn set_auto(&self) -> Result<()> {
        self.stop();
        *self.0.curve.lock() = None;
        let (hwmon, _) = find_amdgpu_hwmon().ok_or_else(|| anyhow!("AMD GPU not found"))?;
        fs::write(PathBuf::from(&hwmon).join("pwm1_enable"), b"2\n")
            .map_err(|e| anyhow!("pwm_enable auto: {e}"))?;
        Ok(())
    }

    pub fn get_status(&self) -> Option<GpuFanStatus> {
        let (hwmon, _) = find_amdgpu_hwmon()?;
        let base = PathBuf::from(&hwmon);
        let rpm = read_sysfs(&base.join("fan1_input")).and_then(|s| s.parse().ok()).unwrap_or(0);
        let pwm = read_sysfs(&base.join("pwm1")).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
        let duty = ((pwm as f32 / 255.0) * 100.0).round() as u8;
        let gpu_temp = read_sysfs(&base.join("temp1_input"))
            .and_then(|s| s.parse::<f32>().ok())
            .map(|t| t / 1000.0)
            .unwrap_or(0.0);
        let controllable = fs::metadata(base.join("pwm1"))
            .map(|m| !m.permissions().readonly())
            .unwrap_or(false);
        Some(GpuFanStatus { name: gpu_product_name(&base), hwmon_path: hwmon, rpm, duty, gpu_temp, controllable })
    }
}

impl Default for GpuFanController {
    fn default() -> Self {
        Self::new()
    }
}

// ── Hwmon scan (case fans) ────────────────────────────────────────────────────

pub fn list_fan_channels() -> Vec<FanChannel> {
    let mut channels = Vec::new();
    let hwmon_base = PathBuf::from("/sys/class/hwmon");
    let Ok(entries) = fs::read_dir(&hwmon_base) else { return channels };
    let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    dirs.sort_by_key(|e| e.file_name());

    for entry in dirs {
        let hwmon_path = entry.path();
        let hwmon_name = hwmon_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let driver = read_sysfs(&hwmon_path.join("name")).unwrap_or_else(|| "unknown".into());

        // GPU handled separately
        if driver == "amdgpu" || driver == "nouveau" { continue; }

        for pwm_idx in 1u8..=8 {
            let pwm_file = hwmon_path.join(format!("pwm{pwm_idx}"));
            if !pwm_file.exists() { continue; }
            let fan_file = hwmon_path.join(format!("fan{pwm_idx}_input"));
            let rpm = read_sysfs(&fan_file).and_then(|s| s.parse().ok()).unwrap_or(0);
            let pwm_raw = read_sysfs(&pwm_file).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let duty = ((pwm_raw as f32 / 255.0) * 100.0).round() as u8;
            let enable = read_sysfs(&hwmon_path.join(format!("pwm{pwm_idx}_enable")))
                .and_then(|s| s.parse::<u8>().ok()).unwrap_or(2);
            let controllable = fs::metadata(&pwm_file).map(|m| !m.permissions().readonly()).unwrap_or(false);
            let label = make_label(&driver, &hwmon_path, pwm_idx);
            channels.push(FanChannel {
                id: format!("{hwmon_name}_pwm{pwm_idx}"),
                label,
                hwmon_path: hwmon_path.to_string_lossy().into(),
                pwm_index: pwm_idx,
                rpm,
                duty,
                auto: enable == 2,
                controllable,
            });
        }
    }
    channels
}

pub fn set_fan_duty(hwmon_path: &str, pwm_index: u8, duty: u8) -> Result<()> {
    fs::write(pwm_file(hwmon_path, pwm_index, "_enable")?, b"1\n").map_err(|e| anyhow!("pwm_enable: {e}"))?;
    write_fan_duty(hwmon_path, pwm_index, duty)
}

pub fn set_fan_auto(hwmon_path: &str, pwm_index: u8) -> Result<()> {
    fs::write(pwm_file(hwmon_path, pwm_index, "_enable")?, b"2\n").map_err(|e| anyhow!("pwm_enable: {e}"))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Only `/sys/class/hwmon/hwmon<N>` is accepted, since the path comes from the webview.
fn validated_hwmon_dir(hwmon_path: &str) -> Result<PathBuf> {
    let id = hwmon_path.strip_prefix(HWMON_ROOT).and_then(|rest| rest.strip_prefix("hwmon"));
    match id {
        Some(n) if !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()) => Ok(PathBuf::from(hwmon_path)),
        _ => Err(anyhow!("Not a hwmon device: {hwmon_path}")),
    }
}

fn pwm_file(hwmon_path: &str, pwm_index: u8, suffix: &str) -> Result<PathBuf> {
    if !(1..=MAX_PWM_INDEX).contains(&pwm_index) {
        return Err(anyhow!("PWM index must be 1-{MAX_PWM_INDEX}, got {pwm_index}"));
    }
    Ok(validated_hwmon_dir(hwmon_path)?.join(format!("pwm{pwm_index}{suffix}")))
}

fn write_fan_duty(hwmon_path: &str, pwm_index: u8, duty: u8) -> Result<()> {
    let pwm_val = ((duty.clamp(0, 100) as f32 / 100.0) * 255.0).round() as u8;
    fs::write(pwm_file(hwmon_path, pwm_index, "")?, format!("{pwm_val}\n")).map_err(|e| anyhow!("pwm write: {e}"))
}

/// A failed temperature read skips the tick: guessing a temperature could drive the fan too low.
fn apply_curve_tick(hwmon: &str, points: &[(u8, u8)]) {
    let temp = match read_sysfs(&PathBuf::from(hwmon).join("temp1_input")).and_then(|s| s.parse::<f32>().ok()) {
        Some(milli) => milli / 1000.0,
        None => {
            log::warn!("GPU fan curve: temperature unreadable, leaving the fan unchanged");
            return;
        }
    };
    let duty = interp_duty(points, temp.round() as u8).clamp(0, 100);
    match write_fan_duty(hwmon, 1, duty) {
        Ok(_) => log::debug!("GPU fan curve tick: temp={temp:.1}°C → duty={duty}%"),
        Err(e) => log::warn!("GPU fan write failed (temp={temp:.1}°C): {e}"),
    }
}

fn find_amdgpu_hwmon() -> Option<(String, String)> {
    let base = PathBuf::from("/sys/class/hwmon");
    let entries = fs::read_dir(&base).ok()?;
    let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    dirs.sort_by_key(|e| e.file_name());
    for entry in dirs {
        let path = entry.path();
        let name = read_sysfs(&path.join("name")).unwrap_or_default();
        if name == "amdgpu" && path.join("pwm1").exists() {
            return Some((path.to_string_lossy().into(), name));
        }
    }
    None
}

const PCI_IDS_PATHS: &[&str] = &["/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids"];

/// Marketing name from the PCI id database, e.g. "Radeon RX 6700/6700 XT / 6800M".
fn gpu_product_name(hwmon: &Path) -> Option<String> {
    let device_dir = hwmon.join("device");
    let hex = |file: &str| read_sysfs(&device_dir.join(file)).map(|s| s.trim_start_matches("0x").to_ascii_lowercase());
    let (vendor, device) = (hex("vendor")?, hex("device")?);
    let db = PCI_IDS_PATHS.iter().find_map(|p| fs::read_to_string(p).ok())?;
    let mut in_vendor = false;
    for line in db.lines() {
        if !line.starts_with('\t') {
            in_vendor = line.starts_with(&format!("{vendor}  "));
        } else if in_vendor && !line.starts_with("\t\t") {
            let entry = line.trim_start_matches('\t');
            if let Some(name) = entry.strip_prefix(&format!("{device}  ")) {
                let bracketed = name.rfind('[').and_then(|i| name[i + 1..].strip_suffix(']'));
                return Some(bracketed.unwrap_or(name).to_string());
            }
        }
    }
    None
}

pub fn interp_duty(points: &[(u8, u8)], temp: u8) -> u8 {
    if points.is_empty() { return 30; }
    if temp <= points[0].0 { return points[0].1; }
    if temp >= points[points.len() - 1].0 { return points[points.len() - 1].1; }
    for i in 0..points.len() - 1 {
        let (t0, s0) = points[i];
        let (t1, s1) = points[i + 1];
        if temp >= t0 && temp <= t1 {
            if t1 == t0 { return s0; }
            let r = (temp - t0) as f32 / (t1 - t0) as f32;
            return (s0 as f32 + r * (s1 as f32 - s0 as f32)).round() as u8;
        }
    }
    points[points.len() - 1].1
}

fn read_sysfs(path: &PathBuf) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn make_label(driver: &str, hwmon_path: &Path, pwm_idx: u8) -> String {
    if let Some(l) = read_sysfs(&hwmon_path.join(format!("fan{pwm_idx}_label"))) {
        if !l.is_empty() { return format!("{} — {}", friendly_driver(driver), l); }
    }
    format!("{} — Fan {}", friendly_driver(driver), pwm_idx)
}

fn friendly_driver(d: &str) -> &str {
    match d {
        "nct6775" | "nct6776" | "nct6779" => "Motherboard",
        "it87" => "Motherboard",
        "asus" | "asusec" => "ASUS EC",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hwmon_devices_with_valid_pwm_index_are_writable() {
        assert!(pwm_file("/sys/class/hwmon/hwmon3", 2, "_enable").is_ok());
        for bad in ["/sys/class/hwmon/hwmon3/../../x", "/sys/class/hwmon/hwmon", "/etc", "/sys/class/hwmon/hwmonx", "../hwmon3"] {
            assert!(pwm_file(bad, 1, "").is_err(), "{bad}");
        }
        assert!(pwm_file("/sys/class/hwmon/hwmon3", 0, "").is_err());
        assert!(pwm_file("/sys/class/hwmon/hwmon3", 9, "").is_err());
    }

    #[test]
    fn empty_curve_is_rejected() {
        assert!(GpuFanController::new().set_curve(vec![]).is_err());
    }
}
