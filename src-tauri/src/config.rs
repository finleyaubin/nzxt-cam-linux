//! Persistence — ~/.config/nzxtcam-archlinux-rust/config.json
//!
//! Single JSON blob that holds AppSettings, the last-used DisplayConfig, the
//! last image/GIF path, etc. Loaded once at startup, written on every change.
//! `version` is the schema version; files without it (pre-versioning) are v0
//! and are migrated on load. Writes are atomic (temp file + rename).

use crate::types::{AppSettings, DisplayConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_DIRNAME: &str = "nzxtcam-archlinux-rust";

/// Current config schema version.
pub const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigFile {
    pub version: u32,
    pub settings: Option<AppSettings>,
    pub display_config: Option<DisplayConfig>,
    pub last_mode: Option<String>,
    pub last_image_path: Option<String>,
    pub last_gif_path: Option<String>,
    pub last_color: Option<LastColor>,
    pub lcd_rotation: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(APP_DIRNAME)
}

pub fn config_file_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn ensure_config_dir() {
    let dir = config_dir();
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
}

/// Upgrade an older file in place. v0 (no `version`) -> v1: the legacy
/// `sensorSources` list is folded into `sensors` by `AppSettings::clamp`.
fn migrate(cfg: &mut ConfigFile) {
    if let Some(s) = cfg.settings.as_mut() {
        s.clamp();
    }
    if cfg.version < CONFIG_VERSION {
        cfg.version = CONFIG_VERSION;
    }
}

/// Parse and validate config JSON; `origin` names the file in error messages.
pub fn parse(json: &str, origin: &str) -> Result<ConfigFile, String> {
    let mut cfg: ConfigFile = serde_json::from_str(json)
        .map_err(|e| format!("{origin}: invalid JSON at line {}, column {}: {e}", e.line(), e.column()))?;
    if cfg.version > CONFIG_VERSION {
        log::warn!("{origin}: written by a newer version (schema {}), loading what is understood", cfg.version);
    }
    migrate(&mut cfg);
    if let Some(dc) = &cfg.display_config {
        dc.validate().map_err(|e| format!("{origin}: displayConfig: {e}"))?;
    }
    if !matches!(cfg.lcd_rotation, 0 | 90 | 180 | 270) {
        return Err(format!("{origin}: lcdRotation must be 0, 90, 180 or 270, got {}", cfg.lcd_rotation));
    }
    Ok(cfg)
}

/// Load the config; a missing file gives defaults, an unreadable one is an error.
pub fn try_load() -> Result<ConfigFile, String> {
    let path = config_file_path();
    match fs::read_to_string(&path) {
        Ok(s) => parse(&s, &path.display().to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConfigFile { version: CONFIG_VERSION, ..Default::default() }),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Like `try_load`, but a bad file is kept as `config.json.bad` (so the next save
/// cannot silently destroy it) and defaults are used.
pub fn load() -> ConfigFile {
    try_load().unwrap_or_else(|e| {
        log::warn!("Config ignored: {e}");
        let path = config_file_path();
        let _ = fs::rename(&path, path.with_extension("json.bad"));
        ConfigFile { version: CONFIG_VERSION, ..Default::default() }
    })
}

/// Write `data` to `path` via a temp file in the same directory, then rename over it.
pub fn write_atomic(path: &std::path::Path, data: &[u8], private: bool) -> anyhow::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    if private {
        // Holds API keys, so keep it private to the user.
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&tmp, path).inspect_err(|_| { let _ = fs::remove_file(&tmp); })?;
    Ok(())
}

pub fn save(cfg: &ConfigFile) -> anyhow::Result<()> {
    ensure_config_dir();
    let mut cfg = cfg.clone();
    cfg.version = CONFIG_VERSION;
    write_atomic(&config_file_path(), serde_json::to_string_pretty(&cfg)?.as_bytes(), true)
}

/// Merge-style save: load → mutate → write.
pub fn update<F>(f: F) -> anyhow::Result<ConfigFile>
where
    F: FnOnce(&mut ConfigFile),
{
    let mut cfg = load();
    f(&mut cfg);
    save(&cfg)?;
    Ok(cfg)
}

pub fn load_settings() -> AppSettings {
    let cfg = load();
    let mut s = cfg.settings.unwrap_or_default();
    s.clamp();
    s
}

pub fn load_display_config() -> Option<DisplayConfig> {
    load().display_config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_file_without_version_loads_and_migrates() {
        let cfg = parse(r#"{"settings": {"sensorSources": ["a", null, "c"]}, "lcdRotation": 90}"#, "t").unwrap();
        assert_eq!(cfg.version, CONFIG_VERSION);
        assert_eq!(cfg.settings.unwrap().sensor_sources(), vec![Some("a".into()), None, Some("c".into())]);
    }

    #[test]
    fn errors_say_what_and_where() {
        let e = parse("{\n \"lcdRotation\": }", "cfg.json").unwrap_err();
        assert!(e.contains("cfg.json") && e.contains("line 2"), "{e}");
        let e = parse(r#"{"lcdRotation": 45}"#, "cfg.json").unwrap_err();
        assert!(e.contains("lcdRotation"), "{e}");
        let e = parse(r##"{"displayConfig": {"background": "#000", "elements": [], "backgroundDim": 95}}"##, "cfg.json").unwrap_err();
        assert!(e.contains("backgroundDim"), "{e}");
    }

    #[test]
    fn atomic_write_replaces_file() {
        let dir = std::env::temp_dir().join(format!("nzxt-cfg-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("c.json");
        write_atomic(&p, b"one", true).unwrap();
        write_atomic(&p, b"two", true).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "two");
        assert!(!p.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
