//! Persistence — ~/.config/nzxtcam-archlinux-rust/config.json
//!
//! Single JSON blob that holds AppSettings, the last-used DisplayConfig, the
//! last image/GIF path, etc. Loaded once at startup, written on every change.
//! `version` is the schema version; files without it (pre-versioning) are v0
//! and are migrated on load. Writes are atomic (temp file + rename).

use crate::secrets;
use crate::types::{AppSettings, DisplayConfig};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
        .expect("no config directory: set HOME or XDG_CONFIG_HOME")
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

/// Like `try_load`, but a bad file is kept as `config.json.bad.<unix time>` (so the next save
/// cannot silently destroy it) and defaults are used.
pub fn load() -> ConfigFile {
    let mut cfg = try_load().unwrap_or_else(|e| {
        log::warn!("Config ignored: {e}");
        let path = config_file_path();
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let _ = fs::rename(&path, path.with_extension(format!("json.bad.{stamp}")));
        ConfigFile { version: CONFIG_VERSION, ..Default::default() }
    });
    let had_plaintext_keys = cfg.settings.as_ref().is_some_and(|s| s.api_keys.values().any(|v| !v.is_empty()));
    fill_api_keys_from_keyring(&mut cfg);
    if had_plaintext_keys {
        match save(&cfg) {
            Ok(()) => log::info!("Moved API keys from config.json into the system keyring"),
            Err(e) => log::error!("API keys are still in config.json, keyring unavailable: {e}"),
        }
    }
    cfg
}

// Keys live in the keyring, not in config.json. This mirrors what the keyring holds so it is
// only queried on first load and written when a value actually changes.
static KEYRING_MIRROR: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

fn fill_api_keys_from_keyring(cfg: &mut ConfigFile) {
    let Some(settings) = cfg.settings.as_mut() else { return };
    let mut mirror = KEYRING_MIRROR.lock();
    if mirror.is_none() {
        let mut keys = BTreeMap::new();
        for name in secrets::KEY_NAMES {
            match secrets::get(name) {
                Ok(Some(value)) => {
                    keys.insert(name.to_string(), value);
                }
                Ok(None) => {}
                Err(e) => {
                    log::error!("Cannot read API keys from the system keyring: {e}");
                    return;
                }
            }
        }
        *mirror = Some(keys);
    }
    for (name, value) in mirror.iter().flatten() {
        // A key still in the file is newer than the keyring (pre-migration config).
        if settings.api_keys.get(name).is_none_or(|v| v.is_empty()) {
            settings.api_keys.insert(name.clone(), value.clone());
        }
    }
}

fn store_changed_keys(
    keys: &BTreeMap<String, String>,
    mirror: &mut Option<BTreeMap<String, String>>,
    mut store: impl FnMut(&str, &str) -> Result<(), String>,
) -> Result<(), String> {
    for (name, value) in keys.iter().filter(|(_, v)| !v.is_empty()) {
        if mirror.as_ref().is_some_and(|m| m.get(name) == Some(value)) {
            continue;
        }
        store(name, value)?;
        if let Some(m) = mirror.as_mut() {
            m.insert(name.clone(), value.clone());
        }
    }
    Ok(())
}

/// Clear a key the user removed; an empty value in `save` never deletes, so a failed keyring read cannot wipe keys.
pub fn remove_api_key(name: &str) -> Result<(), String> {
    secrets::delete(name)?;
    if let Some(mirror) = KEYRING_MIRROR.lock().as_mut() {
        mirror.remove(name);
    }
    Ok(())
}

/// Write `data` to `path` via a temp file in the same directory, then rename over it.
pub fn write_atomic(path: &std::path::Path, data: &[u8], private: bool) -> anyhow::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    if private {
        // Settings and paths are private to the user.
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
    if let Some(settings) = cfg.settings.as_mut() {
        store_changed_keys(&settings.api_keys, &mut KEYRING_MIRROR.lock(), secrets::set).map_err(anyhow::Error::msg)?;
        settings.api_keys.clear();
    }
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
    fn only_changed_non_empty_keys_reach_the_keyring() {
        let keys: BTreeMap<String, String> =
            [("giphy", "new"), ("homeassistant", "same"), ("empty", "")].map(|(k, v)| (k.to_string(), v.to_string())).into();
        let mut mirror = Some(BTreeMap::from([("homeassistant".to_string(), "same".to_string())]));
        let mut stored = Vec::new();
        store_changed_keys(&keys, &mut mirror, |name, value| {
            stored.push((name.to_string(), value.to_string()));
            Ok(())
        })
        .unwrap();
        assert_eq!(stored, [("giphy".to_string(), "new".to_string())]);
        assert_eq!(mirror.unwrap().get("giphy").map(String::as_str), Some("new"));

        let failure = store_changed_keys(&keys, &mut None, |_, _| Err("locked".into()));
        assert_eq!(failure, Err("locked".to_string()));
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
