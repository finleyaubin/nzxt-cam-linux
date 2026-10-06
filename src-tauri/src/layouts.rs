//! Saved LCD layouts — ~/.config/nzxtcam-archlinux-rust/layouts/<slug>.json
//!
//! Each file is a `SavedLayout` (display name + DisplayConfig). A bundle file
//! (`LayoutBundle`) carries several layouts for import/export.

use crate::config::{config_dir, write_atomic};
use crate::types::DisplayConfig;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLayout {
    pub name: String,
    pub config: DisplayConfig,
}

#[derive(Debug, Serialize, Deserialize)]
struct LayoutBundle {
    version: u32,
    layouts: Vec<SavedLayout>,
}

fn layouts_dir() -> PathBuf {
    config_dir().join("layouts")
}

/// Lowercase alphanumerics; everything else becomes '-'.
fn slug(name: &str) -> String {
    name.trim()
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect()
}

fn layout_path(name: &str) -> Result<PathBuf> {
    let s = slug(name);
    if s.trim_matches('-').is_empty() {
        return Err(anyhow!("Layout name cannot be empty"));
    }
    Ok(layouts_dir().join(format!("{s}.json")))
}

fn save_in(dir: &Path, layout: &SavedLayout) -> Result<()> {
    layout.config.validate().map_err(|e| anyhow!("Layout '{}': {e}", layout.name))?;
    let s = slug(&layout.name);
    if s.trim_matches('-').is_empty() {
        return Err(anyhow!("Layout name cannot be empty"));
    }
    fs::create_dir_all(dir)?;
    write_atomic(&dir.join(format!("{s}.json")), serde_json::to_string_pretty(layout)?.as_bytes(), false)
}

pub fn save_layout(name: &str, config: DisplayConfig) -> Result<()> {
    save_in(&layouts_dir(), &SavedLayout { name: name.trim().to_string(), config })
}

pub fn load_layout(name: &str) -> Result<SavedLayout> {
    let path = layout_path(name)?;
    let s = fs::read_to_string(&path).map_err(|_| anyhow!("Layout not found: {name}"))?;
    serde_json::from_str(&s).map_err(|e| anyhow!("{}: invalid layout: {e}", path.display()))
}

pub fn delete_layout(name: &str) -> Result<()> {
    let path = layout_path(name)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn list_layouts() -> Vec<SavedLayout> {
    let Ok(entries) = fs::read_dir(layouts_dir()) else { return vec![] };
    let mut out: Vec<SavedLayout> = entries
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
        .filter_map(|e| serde_json::from_str(&fs::read_to_string(e.path()).ok()?).ok())
        .collect();
    out.sort_by_key(|l| l.name.to_lowercase());
    out
}

/// Write every saved layout to one JSON file.
pub fn export_all(path: &Path) -> Result<usize> {
    let layouts = list_layouts();
    let n = layouts.len();
    let json = serde_json::to_string_pretty(&LayoutBundle { version: 1, layouts })?;
    write_atomic(path, json.as_bytes(), false)?;
    Ok(n)
}

fn parse_bundle(json: &str, origin: &str) -> Result<Vec<SavedLayout>> {
    let bundle: LayoutBundle = serde_json::from_str(json)
        .map_err(|e| anyhow!("{origin}: not a layout file (line {}, column {}): {e}", e.line(), e.column()))?;
    for l in &bundle.layouts {
        l.config.validate().map_err(|e| anyhow!("{origin}: layout '{}': {e}", l.name))?;
    }
    Ok(bundle.layouts)
}

/// Import a bundle written by `export_all`; layouts with the same name are replaced.
pub fn import_all(path: &Path) -> Result<usize> {
    let json = fs::read_to_string(path).map_err(|e| anyhow!("{}: {e}", path.display()))?;
    let layouts = parse_bundle(&json, &path.display().to_string())?;
    for l in &layouts {
        save_in(&layouts_dir(), l)?;
    }
    Ok(layouts.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_bundle_roundtrip() {
        assert_eq!(slug(" My Look! "), "my-look-");
        let dir = std::env::temp_dir().join(format!("nzxt-layouts-test-{}", std::process::id()));
        let l = SavedLayout { name: "My Look".into(), config: DisplayConfig::default() };
        save_in(&dir, &l).unwrap();
        let back: SavedLayout = serde_json::from_str(&fs::read_to_string(dir.join("my-look.json")).unwrap()).unwrap();
        assert_eq!(back.name, "My Look");
        let json = serde_json::to_string(&LayoutBundle { version: 1, layouts: vec![l] }).unwrap();
        assert_eq!(parse_bundle(&json, "x").unwrap().len(), 1);
        assert!(parse_bundle("{}", "x").unwrap_err().to_string().contains("x:"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_layout() {
        let mut c = DisplayConfig::default();
        c.background_dim = 99;
        assert!(save_in(&std::env::temp_dir().join("nzxt-never"), &SavedLayout { name: "a".into(), config: c }).is_err());
    }
}
