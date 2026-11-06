use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const USED_COLORS: &[&str] = &[
    "window_bg_color", "window_fg_color", "headerbar_bg_color", "popover_bg_color",
    "view_bg_color", "card_bg_color", "accent_bg_color", "accent_fg_color",
    "error_color", "warning_color", "success_color",
];
const MAX_IMPORT_DEPTH: u8 = 4;
const MAX_REFERENCE_DEPTH: u8 = 8;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GtkTheme {
    pub colors: HashMap<String, String>,
    pub font_family: Option<String>,
    pub font_size_pt: Option<f32>,
}

fn gtk4_dir() -> PathBuf {
    dirs::config_dir().expect("no XDG config dir").join("gtk-4.0")
}

fn collect_defined_colors(file: &Path, depth: u8, out: &mut HashMap<String, String>) -> Result<(), String> {
    let text = fs::read_to_string(file).map_err(|e| format!("{}: {e}", file.display()))?;
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("@define-color ") {
            if let Some((name, value)) = rest.trim_end_matches(';').split_once(char::is_whitespace) {
                out.insert(name.to_string(), value.trim().to_string());
            }
        } else if let Some(rest) = line.strip_prefix("@import ") {
            if depth >= MAX_IMPORT_DEPTH {
                return Err(format!("{}: @import nesting too deep", file.display()));
            }
            let name = rest.trim_end_matches(';').trim().trim_matches(|c| c == '"' || c == '\'');
            collect_defined_colors(&file.parent().unwrap().join(name), depth + 1, out)?;
        }
    }
    Ok(())
}

fn resolve_hex(defined: &HashMap<String, String>, name: &str) -> Option<String> {
    let mut value = defined.get(name)?;
    for _ in 0..MAX_REFERENCE_DEPTH {
        match value.strip_prefix('@') {
            Some(reference) => value = defined.get(reference)?,
            None => return value.starts_with('#').then(|| value.clone()),
        }
    }
    None
}

const STYLE_WORDS: &[&str] = &[
    "thin", "light", "regular", "medium", "semibold", "bold", "extrabold", "black", "italic", "oblique",
];

/// GTK font names are "Family, Style Size" or "Family [Style] Size".
fn parse_font_name(spec: &str) -> Option<(String, f32)> {
    if let Some((family, style_and_size)) = spec.rsplit_once(',') {
        let size = style_and_size.split_whitespace().last()?.parse().ok()?;
        return Some((family.trim().to_string(), size));
    }
    let mut words: Vec<&str> = spec.split_whitespace().collect();
    let size = words.pop()?.parse().ok()?;
    while words.len() > 1 && words.last().is_some_and(|w| STYLE_WORDS.contains(&w.to_lowercase().as_str())) {
        words.pop();
    }
    Some((words.join(" "), size))
}

fn read_font(settings_ini: &Path) -> Result<Option<(String, f32)>, String> {
    if !settings_ini.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(settings_ini).map_err(|e| format!("{}: {e}", settings_ini.display()))?;
    let spec = text.lines().find_map(|l| l.trim().strip_prefix("gtk-font-name="));
    Ok(spec.and_then(parse_font_name))
}

fn gtk_theme() -> Result<GtkTheme, String> {
    let dir = gtk4_dir();
    let mut defined = HashMap::new();
    let css = dir.join("gtk.css");
    if css.exists() {
        collect_defined_colors(&css, 0, &mut defined)?;
    }
    let colors = USED_COLORS
        .iter()
        .filter_map(|name| resolve_hex(&defined, name).map(|hex| (name.to_string(), hex)))
        .collect();
    let font = read_font(&dir.join("settings.ini"))?;
    Ok(GtkTheme {
        colors,
        font_family: font.as_ref().map(|(family, _)| family.clone()),
        font_size_pt: font.map(|(_, size)| size),
    })
}

type IniSections = HashMap<String, HashMap<String, String>>;

fn parse_ini(text: &str) -> IniSections {
    let mut sections = IniSections::new();
    let mut current = String::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            current = name.to_string();
        } else if let Some((key, value)) = line.split_once('=') {
            sections.entry(current.clone()).or_default().insert(key.to_string(), value.to_string());
        }
    }
    sections
}

fn rgb_to_hex(rgb: &str) -> Option<String> {
    let channels: Vec<u8> = rgb.split(',').map(|c| c.trim().parse().ok()).collect::<Option<_>>()?;
    let [r, g, b] = channels[..] else { return None };
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

fn kde_theme(kdeglobals: &Path) -> Result<GtkTheme, String> {
    let ini = parse_ini(&fs::read_to_string(kdeglobals).map_err(|e| format!("{}: {e}", kdeglobals.display()))?);
    let color = |section: &str, key: &str| ini.get(section)?.get(key).and_then(|v| rgb_to_hex(v));
    let accent = ini.get("General").and_then(|g| g.get("AccentColor")).and_then(|v| rgb_to_hex(v))
        .or_else(|| color("Colors:Selection", "BackgroundNormal"));
    let window_bg = color("Colors:Window", "BackgroundNormal");
    let view_bg = color("Colors:View", "BackgroundNormal");
    let entries = [
        ("window_bg_color", window_bg.clone()),
        ("window_fg_color", color("Colors:Window", "ForegroundNormal")),
        ("headerbar_bg_color", color("Colors:Header", "BackgroundNormal").or(window_bg.clone())),
        ("popover_bg_color", window_bg),
        ("view_bg_color", view_bg.clone()),
        ("card_bg_color", view_bg),
        ("accent_bg_color", accent),
        ("accent_fg_color", color("Colors:Selection", "ForegroundNormal")),
        ("error_color", color("Colors:View", "ForegroundNegative")),
        ("warning_color", color("Colors:View", "ForegroundNeutral")),
        ("success_color", color("Colors:View", "ForegroundPositive")),
    ];
    let colors = entries.into_iter().filter_map(|(name, hex)| Some((name.to_string(), hex?))).collect();
    let font = ini.get("General").and_then(|g| g.get("font")).and_then(|spec| parse_kde_font(spec));
    Ok(GtkTheme {
        colors,
        font_family: font.as_ref().map(|(family, _)| family.clone()),
        font_size_pt: font.map(|(_, size)| size),
    })
}

fn parse_kde_font(spec: &str) -> Option<(String, f32)> {
    let mut fields = spec.split(',');
    Some((fields.next()?.to_string(), fields.next()?.parse().ok()?))
}

fn running_on_kde() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|d| d.split(':').any(|part| part == "KDE"))
}

/// Reads the desktop's theme: KDE's kdeglobals on Plasma, otherwise GTK4 overrides (missing gtk.css = libadwaita defaults).
#[tauri::command]
pub fn get_system_theme() -> Result<GtkTheme, String> {
    let kdeglobals = dirs::config_dir().expect("no XDG config dir").join("kdeglobals");
    if running_on_kde() && kdeglobals.exists() {
        kde_theme(&kdeglobals)
    } else {
        gtk_theme()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_references_and_ignores_non_hex() {
        let defined: HashMap<String, String> = [
            ("a", "#112233"), ("b", "@a"), ("c", "alpha(@a, 0.5)"),
        ].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(resolve_hex(&defined, "b").as_deref(), Some("#112233"));
        assert_eq!(resolve_hex(&defined, "c"), None);
    }

    #[test]
    fn parses_kde_colors_and_font() {
        let ini = parse_ini("[General]\nfont=Noto Sans,10,-1,5\nAccentColor=61,174,233\n[Colors:View]\nBackgroundNormal=35,38,41\n");
        assert_eq!(ini["Colors:View"]["BackgroundNormal"], "35,38,41");
        assert_eq!(rgb_to_hex(&ini["General"]["AccentColor"]).as_deref(), Some("#3daee9"));
        assert_eq!(parse_kde_font(&ini["General"]["font"]), Some(("Noto Sans".into(), 10.0)));
    }

    #[test]
    fn parses_gtk_font_name() {
        assert_eq!(parse_font_name("SF Pro Display, Bold 12"), Some(("SF Pro Display".into(), 12.0)));
        assert_eq!(parse_font_name("Cantarell 11"), Some(("Cantarell".into(), 11.0)));
        assert_eq!(parse_font_name("Noto Sans Bold 10"), Some(("Noto Sans".into(), 10.0)));
    }
}
