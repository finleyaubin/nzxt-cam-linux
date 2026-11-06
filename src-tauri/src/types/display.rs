//! Display scene types — 1:1 with TypeScript shared/display.ts.

use super::*;
use serde::{Deserialize, Serialize};


#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(into = "String", try_from = "String")]
pub enum MetricId {
    Cpu,
    Gpu,
    Liquid,
    Pump,
    /// 0-based slot index; serialised as `sensor{index+1}`.
    Sensor(u8),
}

impl std::str::FromStr for MetricId {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().as_str() {
            "cpu" => Ok(Self::Cpu),
            "gpu" => Ok(Self::Gpu),
            "liquid" => Ok(Self::Liquid),
            "pump" => Ok(Self::Pump),
            other => other
                .strip_prefix("sensor")
                .and_then(|n| n.parse::<usize>().ok())
                .filter(|n| (1..=MAX_SENSORS).contains(n))
                .map(|n| Self::Sensor((n - 1) as u8))
                .ok_or_else(|| format!("unknown metric {s}")),
        }
    }
}

impl TryFrom<String> for MetricId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        s.parse()
    }
}

impl From<MetricId> for String {
    fn from(m: MetricId) -> String {
        match m {
            MetricId::Cpu => "cpu".into(),
            MetricId::Gpu => "gpu".into(),
            MetricId::Liquid => "liquid".into(),
            MetricId::Pump => "pump".into(),
            MetricId::Sensor(i) => format!("sensor{}", i + 1),
        }
    }
}

impl MetricId {
    pub fn unit(&self) -> &'static str {
        match self {
            MetricId::Cpu | MetricId::Gpu | MetricId::Liquid => "°",
            MetricId::Pump => "",
            MetricId::Sensor(i) => crate::sensors::slot_unit(*i as usize),
        }
    }
    pub fn value_from(&self, t: Temperatures) -> f64 {
        match self {
            MetricId::Cpu => t.cpu,
            MetricId::Gpu => t.gpu,
            MetricId::Liquid => t.liquid,
            MetricId::Pump => t.pump_rpm,
            MetricId::Sensor(i) => t.sensors.get(*i as usize).copied().unwrap_or(NO_READING),
        }
    }
}

/// Where a gauge draws its label and value.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextPosition {
    /// Centred in the ring.
    #[default]
    Center,
    /// At the bottom of the ring, for split rings with an opening there.
    Bottom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GaugeElement {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub metric: MetricId,
    pub radius: f32,
    pub thickness: f32,
    pub max: f64,
    pub color: String,
    pub track_color: String,
    pub start_angle: f32,
    pub sweep: f32,
    pub warn_color: String,
    pub warn_at: f64,
    pub show_value: bool,
    pub show_label: bool,
    pub label: String,
    pub value_size: f32,
    /// Corner radius in px at the arc ends (0 = square).
    #[serde(default)]
    pub corner_radius: f32,
    /// Fill blends from `color` to this along the arc.
    #[serde(default)]
    pub gradient_to: Option<String>,
    #[serde(default)]
    pub text_position: TextPosition,
    /// Print 0 and `max` at the two ends of a partial arc.
    #[serde(default)]
    pub show_range: bool,
    /// Direction of the min/max labels around their arc end: 0° toward the gauge centre, 90° along the arc into the gauge.
    #[serde(default)]
    pub range_angle: f32,
    /// Distance in px of the min/max labels from the centre of their arc end.
    #[serde(default)]
    pub range_offset: f32,
    /// Show the value in a pill at the top of the ring, filled with the track colour, instead of in the centre.
    #[serde(default)]
    pub value_pill: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarElement {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub metric: MetricId,
    pub width: f32,
    pub height: f32,
    pub max: f64,
    pub color: String,
    pub track_color: String,
    pub warn_color: String,
    pub warn_at: f64,
    pub show_value: bool,
    pub show_label: bool,
    pub label: String,
    pub value_size: f32,
    /// 0 = solid bar, otherwise number of discrete segments.
    #[serde(default)]
    pub segments: u8,
    /// Corner radius in px; None = fully rounded ends.
    #[serde(default)]
    pub corner_radius: Option<f32>,
    /// Fill blends from `color` to this along the bar.
    #[serde(default)]
    pub gradient_to: Option<String>,
}

/// Line chart of a metric's recent history; newest value at the right edge. (x, y) is the centre.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphElement {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub metric: MetricId,
    pub width: f32,
    pub height: f32,
    /// Value at the top of the plot; the bottom is 0.
    pub max: f64,
    pub color: String,
    /// Panel behind the plot.
    pub track_color: String,
    pub warn_color: String,
    pub warn_at: f64,
    pub show_value: bool,
    pub show_label: bool,
    pub label: String,
    pub value_size: f32,
    /// Seconds of history across the full width.
    #[serde(default = "default_graph_window")]
    pub window_secs: u16,
    /// Tint the area under the line.
    #[serde(default)]
    pub fill: bool,
    #[serde(default = "default_line_width")]
    pub line_width: f32,
    #[serde(default)]
    pub corner_radius: f32,
}

fn default_graph_window() -> u16 {
    60
}

fn default_line_width() -> f32 {
    3.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub text: String,
    pub color: String,
    pub size: f32,
    pub align: TextAlign,
    /// Font family for this text; the scene's font when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
}

fn full_opacity() -> u8 {
    100
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageElement {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// Picture file (PNG, JPEG, WebP, BMP or the first frame of a GIF), scaled to fit the box.
    pub path: String,
    /// 0-100
    #[serde(default = "full_opacity")]
    pub opacity: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum DisplayElement {
    Gauge(GaugeElement),
    Bar(BarElement),
    Graph(GraphElement),
    Text(TextElement),
    Image(ImageElement),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub background: String,
    pub elements: Vec<DisplayElement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default)]
    pub decimals: u8,
    /// Photo or GIF drawn behind the elements.
    #[serde(default)]
    pub background_image: Option<String>,
    /// Darken the background image by this percentage (0-90) so stats stay legible.
    #[serde(default)]
    pub background_dim: u8,
    /// Installed font family used for all text; the built-in font when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
}

impl DisplayConfig {
    /// Reject configs the renderer could not sensibly draw; messages name the offending field.
    pub fn validate(&self) -> Result<(), String> {
        if self.decimals > 2 {
            return Err(format!("decimals must be 0-2, got {}", self.decimals));
        }
        if self.background_dim > 90 {
            return Err(format!("backgroundDim must be 0-90, got {}", self.background_dim));
        }
        let fonts = self.font.iter().chain(self.elements.iter().filter_map(|el| match el {
            DisplayElement::Text(t) => t.font.as_ref(),
            _ => None,
        }));
        if let Some(name) = fonts.into_iter().find(|name| name.len() > 200) {
            return Err(format!("font name is too long ({} bytes)", name.len()));
        }
        if self.elements.len() > 64 {
            return Err(format!("elements has {} entries, the maximum is 64", self.elements.len()));
        }
        for (i, el) in self.elements.iter().enumerate() {
            if let DisplayElement::Image(img) = el {
                if img.opacity > 100 {
                    return Err(format!("elements[{i}].opacity must be 0-100, got {}", img.opacity));
                }
            }
        }
        Ok(())
    }
}

impl Default for DisplayConfig {
    fn default() -> Self {
        // The "triple-rings" preset is the default in the TS code.
        // We can't easily call frontend code from Rust, so we provide a sane
        // server-side default; the frontend will overwrite with its preset
        // on first run via save_display_config.
        Self {
            background: "#0a0a0f".into(),
            elements: Vec::new(),
            variant: None,
            decimals: 0,
            background_image: None,
            background_dim: 0,
            font: None,
        }
    }
}
