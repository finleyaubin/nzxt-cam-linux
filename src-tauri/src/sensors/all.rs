//! Every temperature sensor on the system: all hwmon tempN inputs plus NVIDIA GPUs via nvidia-smi.

use crate::sensors::cpu::read_milli_temp;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

const HWMON_DIR: &str = "/sys/class/hwmon";
const NVIDIA_PREFIX: &str = "nvidia-smi:";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensor {
    pub id: String,
    pub label: String,
}

static PATHS: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);
static NVIDIA_CACHE: Mutex<Option<(Instant, Vec<f64>)>> = Mutex::new(None);

// hwmonN numbering changes between boots, so ids are keyed on the underlying device path.
fn scan_hwmon() -> Vec<(TempSensor, PathBuf)> {
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
            let Some(n) = file.strip_prefix("temp").and_then(|s| s.strip_suffix("_input")) else { continue };
            let label = fs::read_to_string(base.join(format!("temp{n}_label")))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| format!("temp{n}"));
            out.push((
                TempSensor {
                    id: format!("{key}|{file}"),
                    label: format!("{name} · {label} ({dev_short})"),
                },
                f.path(),
            ));
        }
    }
    out.sort_by(|a, b| a.0.label.cmp(&b.0.label));
    out
}

fn nvidia_temps() -> Vec<f64> {
    let mut cache = NVIDIA_CACHE.lock();
    if let Some((at, temps)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(2) {
            return temps.clone();
        }
    }
    let temps: Vec<f64> = Command::new("nvidia-smi")
        .args(["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|l| l.trim().parse().ok())
                .collect()
        })
        .unwrap_or_default();
    *cache = Some((Instant::now(), temps.clone()));
    temps
}

pub fn nvidia_ids() -> Vec<String> {
    (0..nvidia_temps().len()).map(|i| format!("{NVIDIA_PREFIX}{i}")).collect()
}

pub fn list_temp_sensors() -> Vec<TempSensor> {
    let hwmon = scan_hwmon();
    let mut sensors: Vec<TempSensor> = nvidia_ids()
        .into_iter()
        .enumerate()
        .map(|(i, id)| TempSensor { id, label: format!("NVIDIA GPU {i} (nvidia-smi)") })
        .collect();
    *PATHS.lock() = Some(hwmon.iter().map(|(s, p)| (s.id.clone(), p.clone())).collect());
    sensors.extend(hwmon.into_iter().map(|(s, _)| s));
    sensors
}

pub fn read_sensor(id: &str) -> Option<f64> {
    if let Some(idx) = id.strip_prefix(NVIDIA_PREFIX) {
        return nvidia_temps().get(idx.parse::<usize>().ok()?).copied();
    }
    let cached = PATHS.lock().as_ref().and_then(|m| m.get(id).cloned());
    let path = match cached {
        Some(p) => p,
        None => {
            list_temp_sensors();
            PATHS.lock().as_ref()?.get(id)?.clone()
        }
    };
    read_milli_temp(&path)
}
