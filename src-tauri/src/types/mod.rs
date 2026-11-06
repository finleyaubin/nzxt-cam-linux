//! Shared types — mirror the TypeScript shared/display.ts plus driver/sensor types.
//! All structs serialize as camelCase for direct Tauri ↔ React JSON exchange.

use serde::{Deserialize, Serialize};

// ============================================================================
// LCD constants — single source of truth (kept in sync with frontend constants)
// ============================================================================
pub const LCD_SIZE: u32 = 640;
pub const LCD_WIDTH: u32 = 640;
pub const LCD_HEIGHT: u32 = 640;

// ============================================================================
// Temperatures / device status
// ============================================================================

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Temperatures {
    pub cpu: f64,
    pub gpu: f64,
    pub liquid: f64,
    pub pump_rpm: f64,
    pub sensors: [f64; MAX_SENSORS],
}

/// User-bound sensor slots (`sensor1`..`sensorN` metrics).
pub const MAX_SENSORS: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub connected: bool,
    pub product_name: String,
    pub pid: Option<u16>,
    pub error: Option<String>,
    pub lcd_controllable: bool,
}

impl DeviceStatus {
    pub fn disconnected() -> Self {
        Self {
            connected: false,
            product_name: "Not detected".into(),
            pid: None,
            error: None,
            lcd_controllable: false,
        }
    }
}

// ============================================================================
// GPU sources (hwmon detection result)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSource {
    pub id: String,       // PCI address, stable
    pub label: String,    // human-readable
    pub pci: String,
    pub temp_path: String,
    pub discrete: bool,
}

// ============================================================================
// App settings — clamped on save
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub gpu_source: Option<String>,
    pub cpu_source: Option<String>,
    /// Slot i is metric `sensor{i+1}`; removed slots keep their place (source = None) so layouts never shift.
    pub sensors: Vec<SensorSlot>,
    /// Pre-slot format, read once for migration.
    #[serde(skip_serializing)]
    sensor_sources: Vec<Option<String>>,
    /// Third-party API keys by service name, e.g. "giphy".
    pub api_keys: std::collections::BTreeMap<String, String>,
    /// Base URL of a Home Assistant server; its access token is `api_keys["homeassistant"]`.
    pub home_assistant_url: String,
    pub selected_device: String,
    pub poll_interval_ms: u64,
    pub lcd_poll_ms: u64,
    pub lcd_min_push_ms: u64,
    pub decimals: u8,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            gpu_source: None,
            cpu_source: None,
            sensors: Vec::new(),
            sensor_sources: Vec::new(),
            api_keys: Default::default(),
            home_assistant_url: String::new(),
            selected_device: "nzxt-kraken-elite-v2".into(),
            poll_interval_ms: 1000,
            lcd_poll_ms: 500,
            lcd_min_push_ms: 200,
            decimals: 0,
        }
    }
}

impl AppSettings {
    pub fn clamp(&mut self) {
        self.poll_interval_ms = self.poll_interval_ms.clamp(100, 60_000);
        self.lcd_poll_ms = self.lcd_poll_ms.clamp(50, 60_000);
        self.lcd_min_push_ms = self.lcd_min_push_ms.clamp(0, 10_000);
        self.decimals = self.decimals.min(2);
        if self.sensors.is_empty() {
            let old = std::mem::take(&mut self.sensor_sources);
            self.sensors = old.into_iter().map(|source| SensorSlot { source, max: None }).collect();
        }
        self.sensors.truncate(MAX_SENSORS);
        while self.sensors.last().is_some_and(|s| s.source.is_none()) {
            self.sensors.pop();
        }
    }

    pub fn apply_home_assistant(&self) {
        crate::sensors::ha::configure(&self.home_assistant_url, self.api_keys.get("homeassistant").map_or("", String::as_str));
    }

    pub fn sensor_sources(&self) -> Vec<Option<String>> {
        self.sensors.iter().map(|s| s.source.clone()).collect()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SensorSlot {
    pub source: Option<String>,
    /// Value shown as 100% on gauges and bars; None = default for the unit.
    pub max: Option<f64>,
}

mod display;
pub use display::*;

// ============================================================================
// Ring LED lighting
// ============================================================================

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RingSpeed {
    Slowest,
    Slower,
    Normal,
    Faster,
    Fastest,
}

impl RingSpeed {
    pub fn idx(self) -> usize {
        match self {
            Self::Slowest => 0,
            Self::Slower  => 1,
            Self::Normal  => 2,
            Self::Faster  => 3,
            Self::Fastest => 4,
        }
    }
}

/// Channel IDs (liquidctl KrakenX3 convention).
/// On older X3 models: external=0x01, ring=0x02, logo=0x04.
/// On newer Z3/Elite models the mapping differs — use the UI picker to discover.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RingChannel {
    /// 0x01 — external accessories (HUE2, strips…) OR AIO ring on some models
    Ch01,
    /// 0x02 — pump ring on X3, OR external fans on Z3/Elite
    Ch02,
    /// 0x04 — logo LED
    Ch04,
    /// 0x07 — all channels at once
    Ch07,
}

impl RingChannel {
    pub fn byte(self) -> u8 {
        match self {
            Self::Ch01 => 0x01,
            Self::Ch02 => 0x02,
            Self::Ch04 => 0x04,
            Self::Ch07 => 0x07,
        }
    }
    /// Static timing value per channel (from liquidctl _STATIC_VALUE)
    pub fn static_val(self) -> u8 {
        match self {
            Self::Ch01 => 40,
            Self::Ch02 => 8,
            Self::Ch04 => 1,
            Self::Ch07 => 40,
        }
    }
}

/// Each variant maps directly to a liquidctl KrakenX3 color mode.
/// Colors are RGB on the wire — the USB layer converts to GRB.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum RingMode {
    Off,
    Fixed { r: u8, g: u8, b: u8 },
    Breathing { r: u8, g: u8, b: u8, speed: RingSpeed },
    Pulse { r: u8, g: u8, b: u8, speed: RingSpeed },
    Fading { colors: Vec<[u8; 3]>, speed: RingSpeed },
    SpectrumWave { speed: RingSpeed },
    RainbowFlow { speed: RingSpeed },
    RainbowPulse { speed: RingSpeed },
    SuperRainbow { speed: RingSpeed },
    Marquee { r: u8, g: u8, b: u8, speed: RingSpeed },
    StaryNight { r: u8, g: u8, b: u8, speed: RingSpeed },
}

// ============================================================================
// File dialog filters (mirrors Tauri 2 dialog filter shape)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// ============================================================================
// Helpers
// ============================================================================

/// Format a metric value with N decimals (0..=2).
pub fn format_metric(v: f64, decimals: u8) -> String {
    let d = decimals.min(2) as usize;
    format!("{:.*}", d, v)
}

/// Resolve `{variable}` tokens in a free-form string: any metric (`{cpu}`, `{gpu}`, `{liquid}`,
/// `{pump}`, `{sensor1}`..) plus `{time}` and `{date}`. Metrics take a per-token precision
/// override via `{cpu:1}`; unknown tokens are left as typed.
pub fn resolve_text(text: &str, t: Temperatures, decimals: u8) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end_rel) = bytes[i..].iter().position(|&b| b == b'}') {
                let end = i + end_rel;
                let inner = &text[i + 1..end];
                let (key, dec_override) = match inner.split_once(':') {
                    Some((k, d)) => (k, d.parse::<u8>().ok()),
                    None => (inner, None),
                };
                let clock = match key.to_ascii_lowercase().as_str() {
                    "time" => Some("%H:%M"),
                    "date" => Some("%a %d %b"),
                    _ => None,
                };
                if let Some(fmt) = clock.filter(|_| dec_override.is_none()) {
                    out.push_str(&chrono::Local::now().format(fmt).to_string());
                    i = end + 1;
                    continue;
                }
                let metric = key.parse::<MetricId>().ok();
                if let Some(m) = metric {
                    let d = dec_override.unwrap_or(decimals).min(2);
                    out.push_str(&format_metric(m.value_from(t), d));
                    i = end + 1;
                    continue;
                }
            }
        }
        // Push UTF-8 codepoint properly
        let ch_end = (i + 1..=text.len())
            .find(|&j| text.is_char_boundary(j))
            .unwrap_or(text.len());
        out.push_str(&text[i..ch_end]);
        i = ch_end;
    }
    out
}

/// Parse a #rrggbb / #rgb hex color into 8-bit RGB.
pub fn hex_to_rgb(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#').trim();
    let normalized = if h.len() == 3 {
        h.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        h.to_string()
    };
    let n = u32::from_str_radix(&normalized, 16).unwrap_or(0);
    (((n >> 16) & 0xff) as u8, ((n >> 8) & 0xff) as u8, (n & 0xff) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_ids_round_trip() {
        for s in ["cpu", "pump", "sensor1", "sensor8"] {
            let m: MetricId = serde_json::from_value(serde_json::json!(s)).unwrap();
            assert_eq!(serde_json::to_value(m).unwrap(), serde_json::json!(s));
        }
        assert_eq!("sensor3".parse::<MetricId>(), Ok(MetricId::Sensor(2)));
        assert!("sensor0".parse::<MetricId>().is_err());
        assert!("sensor9".parse::<MetricId>().is_err());
    }

    #[test]
    fn old_sensor_sources_migrate_to_slots() {
        let mut s: AppSettings = serde_json::from_str(r#"{"sensorSources": ["a", null, "c", null]}"#).unwrap();
        s.clamp();
        assert_eq!(s.sensor_sources(), vec![Some("a".into()), None, Some("c".into())]);
        assert!(!serde_json::to_string(&s).unwrap().contains("sensorSources"));
    }

    #[test]
    fn sensor_tokens_resolve() {
        let mut t = Temperatures::default();
        t.sensors[4] = 42.0;
        assert_eq!(resolve_text("{sensor5}%", t, 0), "42%");
    }

    #[test]
    fn clock_tokens_resolve_and_unknown_tokens_survive() {
        let t = Temperatures::default();
        let time = resolve_text("{time}", t, 0);
        assert_eq!(time.len(), 5);
        assert_eq!(time.as_bytes()[2], b':');
        assert!(!resolve_text("{date}", t, 0).contains('{'));
        assert_eq!(resolve_text("{nope} {cpu:1}", t, 0), "{nope} 0.0");
    }

    #[test]
    fn graph_elements_round_trip_with_defaults() {
        let json = r##"{"type":"graph","id":"g","x":1,"y":2,"metric":"gpu","width":300,"height":120,"max":100,
            "color":"#fff","trackColor":"#000","warnColor":"#f00","warnAt":90,"showValue":true,"showLabel":true,
            "label":"GPU","valueSize":20}"##;
        let el: DisplayElement = serde_json::from_str(json).unwrap();
        let DisplayElement::Graph(g) = el else { panic!("expected graph") };
        assert_eq!((g.window_secs, g.fill, g.line_width), (60, false, 3.0));
    }

    #[test]
    fn fonts_are_optional_and_survive_a_round_trip() {
        let old: DisplayConfig = serde_json::from_str(r##"{"background":"#000","elements":[]}"##).unwrap();
        assert_eq!(old.font, None);
        let json = r##"{"background":"#000","font":"Fira Sans","elements":[
            {"type":"text","id":"t","x":1,"y":2,"text":"hi","color":"#fff","size":20,"align":"left","font":"Lato"}]}"##;
        let cfg: DisplayConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.font.as_deref(), Some("Fira Sans"));
        let DisplayElement::Text(t) = &cfg.elements[0] else { panic!("expected text") };
        assert_eq!(t.font.as_deref(), Some("Lato"));
        let back = serde_json::to_string(&DisplayConfig { font: None, ..cfg }).unwrap();
        assert!(!back.contains("Fira Sans") && back.contains("Lato"));
    }
}
