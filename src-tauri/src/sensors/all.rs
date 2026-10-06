//! Every readable system sensor: hwmon inputs, NVIDIA GPUs via nvidia-smi, and CPU/RAM stats from /proc.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

const HWMON_DIR: &str = "/sys/class/hwmon";
const NVIDIA_PREFIX: &str = "nvidia-smi:";

/// (sysfs prefix, divisor to SI-ish unit, unit)
const HWMON_KINDS: &[(&str, f64, &str)] = &[
    ("temp", 1000.0, "°"),
    ("fan", 1.0, "rpm"),
    ("in", 1000.0, "V"),
    ("curr", 1000.0, "A"),
    ("power", 1_000_000.0, "W"),
    ("freq", 1_000_000.0, "MHz"),
];

/// (nvidia-smi query field, label, unit)
const NVIDIA_FIELDS: &[(&str, &str, &str)] = &[
    ("temperature.gpu", "temperature", "°"),
    ("utilization.gpu", "load", "%"),
    ("memory.used", "VRAM used", "MiB"),
    ("power.draw", "power", "W"),
    ("fan.speed", "fan", "%"),
    ("clocks.gr", "clock", "MHz"),
];

const SYSTEM: &[(&str, &str, &str)] = &[
    ("sys:cpu_load", "System · CPU load", "%"),
    ("sys:cpu_mhz", "System · CPU clock (avg)", "MHz"),
    ("sys:ram_pct", "System · RAM used", "%"),
    ("sys:ram_gb", "System · RAM used", "GB"),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    pub id: String,
    pub label: String,
    pub unit: String,
}

static PATHS: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);
static NVIDIA_CACHE: Mutex<Option<(Instant, Vec<Vec<Option<f64>>>)>> = Mutex::new(None);
static CPU_LAST: Mutex<Option<(u64, u64, f64)>> = Mutex::new(None);

fn hwmon_kind(file: &str) -> Option<(&'static str, f64, &'static str, &str)> {
    let stem = file.strip_suffix("_input").or_else(|| file.strip_suffix("_average"))?;
    HWMON_KINDS.iter().find_map(|&(prefix, div, unit)| {
        let n = stem.strip_prefix(prefix)?;
        n.chars().all(|c| c.is_ascii_digit()).then_some((prefix, div, unit, n))
    })
}

// hwmonN numbering changes between boots, so ids are keyed on the underlying device path.
fn scan_hwmon() -> Vec<(Sensor, PathBuf)> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(HWMON_DIR) else { return out };
    for entry in entries.flatten() {
        let base = entry.path();
        let Ok(name) = fs::read_to_string(base.join("name")) else { continue };
        let name = name.trim();
        let device = fs::canonicalize(base.join("device")).ok();
        let key = device.as_ref().map_or(name.to_string(), |d| d.to_string_lossy().into_owned());
        let dev_short = device
            .as_ref()
            .and_then(|d| d.file_name())
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();

        let Ok(files) = fs::read_dir(&base) else { continue };
        for f in files.flatten() {
            let file = f.file_name().to_string_lossy().into_owned();
            let Some((prefix, _, unit, n)) = hwmon_kind(&file) else { continue };
            let label = fs::read_to_string(base.join(format!("{prefix}{n}_label")))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| format!("{prefix}{n}"));
            out.push((
                Sensor {
                    id: format!("{key}|{file}"),
                    label: format!("{name} · {label} ({dev_short})"),
                    unit: unit.into(),
                },
                f.path(),
            ));
        }
    }
    out.sort_by(|a, b| a.0.label.cmp(&b.0.label));
    out
}

fn nvidia_values() -> Vec<Vec<Option<f64>>> {
    let mut cache = NVIDIA_CACHE.lock();
    if let Some((at, values)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(2) {
            return values.clone();
        }
    }
    let fields: Vec<&str> = NVIDIA_FIELDS.iter().map(|f| f.0).collect();
    // ponytail: one blocking nvidia-smi spawn per 2s, switch to NVML if it shows up in profiles
    let values: Vec<Vec<Option<f64>>> = Command::new("nvidia-smi")
        .arg(format!("--query-gpu={}", fields.join(",")))
        .arg("--format=csv,noheader,nounits")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.split(',').map(|v| v.trim().parse().ok()).collect())
                .collect()
        })
        .unwrap_or_default();
    *cache = Some((Instant::now(), values.clone()));
    values
}

/// Ids of each NVIDIA GPU's temperature sensor.
pub fn nvidia_ids() -> Vec<String> {
    (0..nvidia_values().len()).map(|i| format!("{NVIDIA_PREFIX}{i}")).collect()
}

fn read_nvidia(rest: &str) -> Option<f64> {
    let (gpu, field) = rest.split_once(':').unwrap_or((rest, NVIDIA_FIELDS[0].0));
    let col = NVIDIA_FIELDS.iter().position(|f| f.0 == field)?;
    *nvidia_values().get(gpu.parse::<usize>().ok()?)?.get(col)?
}

fn meminfo_kb(key: &str, meminfo: &str) -> Option<f64> {
    meminfo.lines().find(|l| l.starts_with(key))?.split_whitespace().nth(1)?.parse().ok()
}

fn read_system(id: &str) -> Option<f64> {
    match id {
        "sys:cpu_load" => {
            let stat = fs::read_to_string("/proc/stat").ok()?;
            let nums: Vec<u64> = stat.lines().next()?.split_whitespace().skip(1).filter_map(|v| v.parse().ok()).collect();
            let idle = nums.get(3)? + nums.get(4).unwrap_or(&0);
            let total: u64 = nums.iter().sum();
            let mut last = CPU_LAST.lock();
            let pct = match *last {
                Some((t0, i0, _)) if total > t0 => 100.0 * (1.0 - (idle - i0) as f64 / (total - t0) as f64),
                Some((_, _, prev)) => prev,
                None => 0.0,
            };
            *last = Some((total, idle, pct));
            Some(pct)
        }
        "sys:cpu_mhz" => {
            let info = fs::read_to_string("/proc/cpuinfo").ok()?;
            let mhz: Vec<f64> = info
                .lines()
                .filter(|l| l.starts_with("cpu MHz"))
                .filter_map(|l| l.split(':').nth(1)?.trim().parse().ok())
                .collect();
            (!mhz.is_empty()).then(|| mhz.iter().sum::<f64>() / mhz.len() as f64)
        }
        "sys:ram_pct" | "sys:ram_gb" => {
            let info = fs::read_to_string("/proc/meminfo").ok()?;
            let total = meminfo_kb("MemTotal:", &info)?;
            let used = total - meminfo_kb("MemAvailable:", &info)?;
            Some(if id == "sys:ram_pct" { 100.0 * used / total } else { used / 1_048_576.0 })
        }
        _ => None,
    }
}

pub fn list_sensors() -> Vec<Sensor> {
    let mut sensors: Vec<Sensor> = SYSTEM
        .iter()
        .map(|&(id, label, unit)| Sensor { id: id.into(), label: label.into(), unit: unit.into() })
        .collect();
    for gpu in 0..nvidia_values().len() {
        for (i, &(field, label, unit)) in NVIDIA_FIELDS.iter().enumerate() {
            // Temperature keeps the short id that GPU source settings already store.
            let id = if i == 0 { format!("{NVIDIA_PREFIX}{gpu}") } else { format!("{NVIDIA_PREFIX}{gpu}:{field}") };
            sensors.push(Sensor { id, label: format!("NVIDIA GPU {gpu} · {label}"), unit: unit.into() });
        }
    }
    sensors.extend(super::ha::list());
    let hwmon = scan_hwmon();
    *PATHS.lock() = Some(hwmon.iter().map(|(s, p)| (s.id.clone(), p.clone())).collect());
    sensors.extend(hwmon.into_iter().map(|(s, _)| s));
    sensors
}

pub fn unit_of(id: &str) -> &'static str {
    if id.starts_with(super::ha::PREFIX) {
        return super::ha::unit_of(id);
    }
    if let Some(rest) = id.strip_prefix(NVIDIA_PREFIX) {
        let field = rest.split_once(':').map_or(NVIDIA_FIELDS[0].0, |(_, f)| f);
        return NVIDIA_FIELDS.iter().find(|f| f.0 == field).map_or("", |f| f.2);
    }
    if let Some(s) = SYSTEM.iter().find(|s| s.0 == id) {
        return s.2;
    }
    id.rsplit('|').next().and_then(hwmon_kind).map_or("", |k| k.2)
}

pub fn read_sensor(id: &str) -> Option<f64> {
    if let Some(rest) = id.strip_prefix(NVIDIA_PREFIX) {
        return read_nvidia(rest);
    }
    if id.starts_with("sys:") {
        return read_system(id);
    }
    if id.starts_with(super::ha::PREFIX) {
        return super::ha::read(id);
    }
    let cached = PATHS.lock().as_ref().and_then(|m| m.get(id).cloned());
    let path = match cached {
        Some(p) => p,
        None => {
            list_sensors();
            PATHS.lock().as_ref()?.get(id)?.clone()
        }
    };
    let (_, div, _, _) = hwmon_kind(path.file_name()?.to_str()?)?;
    let raw: f64 = fs::read_to_string(&path).ok()?.trim().parse().ok()?;
    Some(raw / div)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_resolve_from_ids() {
        assert_eq!(unit_of("/sys/devices/platform/coretemp.0|temp3_input"), "°");
        assert_eq!(unit_of("/sys/devices/x|fan2_input"), "rpm");
        assert_eq!(unit_of("/sys/devices/x|power1_average"), "W");
        assert_eq!(unit_of("/sys/devices/x|temp1_label"), "");
        assert_eq!(unit_of("nvidia-smi:0"), "°");
        assert_eq!(unit_of("nvidia-smi:0:utilization.gpu"), "%");
        assert_eq!(unit_of("sys:ram_gb"), "GB");
    }

    #[test]
    fn system_stats_are_plausible() {
        read_system("sys:cpu_load");
        let load = read_system("sys:cpu_load").unwrap();
        assert!((0.0..=100.0).contains(&load));
        let ram = read_system("sys:ram_pct").unwrap();
        assert!(ram > 0.0 && ram < 100.0);
    }
}
