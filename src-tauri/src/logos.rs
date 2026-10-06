//! Logos found on this machine (distro, desktop, kernel, GPU/CPU vendor) to use as image widgets.
//! Only PNGs are picked up: that is what the renderer can draw.

use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const MAX_DEPTH: usize = 5;
const THUMB_PX: u32 = 96;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_LOGOS: usize = 80;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLogo {
    pub label: String,
    pub group: String,
    pub path: String,
    /// Small PNG preview as a data URL.
    pub thumb: String,
}

const DESKTOP_ICONS: &[(&str, &[&str])] = &[
    ("kde", &["plasma", "kde", "start-here-kde", "plasma-logo", "kde-logo"]),
    ("plasma", &["plasma", "kde", "start-here-kde", "plasma-logo", "kde-logo"]),
    ("gnome", &["gnome-logo", "gnome", "start-here-gnome"]),
    ("hyprland", &["hyprland", "hyprland-logo"]),
    ("sway", &["sway", "sway-logo"]),
    ("xfce", &["xfce4-logo", "xfce", "org.xfce.xfce4", "start-here-xfce"]),
    ("cinnamon", &["cinnamon", "start-here-cinnamon"]),
    ("mate", &["mate", "start-here-mate"]),
    ("budgie", &["budgie", "start-here-budgie"]),
    ("lxqt", &["lxqt", "start-here-lxqt"]),
    ("i3", &["i3", "i3wm"]),
    ("cosmic", &["cosmic", "start-here-cosmic"]),
];

const VENDOR_ICONS: &[(&str, &[&str])] = &[
    ("nvidia", &["nvidia", "nvidia-logo", "nvidia-settings"]),
    ("amd", &["amd", "amd-logo", "amdgpu", "radeon", "radeon-logo"]),
    ("intel", &["intel", "intel-logo"]),
];

const KERNEL_ICONS: &[&str] = &["tux", "linux", "linux-logo", "tux-logo"];

fn os_release_value<'a>(os_release: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}=");
    let value = os_release.lines().find_map(|l| l.strip_prefix(prefix.as_str()))?.trim().trim_matches('"');
    (!value.is_empty()).then_some(value)
}

/// Icon names a distribution's logo is usually installed under, most specific first.
pub fn distro_stems(os_release: &str) -> Vec<String> {
    let mut stems: Vec<String> = os_release_value(os_release, "LOGO").map(String::from).into_iter().collect();
    let ids = os_release_value(os_release, "ID").into_iter().chain(os_release_value(os_release, "ID_LIKE").into_iter().flat_map(|v| v.split_whitespace()));
    for id in ids {
        stems.extend([format!("{id}-logo"), format!("{id}logo"), id.to_string(), format!("distributor-logo-{id}"), format!("start-here-{id}")]);
    }
    stems.push("distributor-logo".into());
    stems
}

/// Icon names for the running desktop or compositor, from XDG_CURRENT_DESKTOP-style values ("KDE", "Hyprland", "ubuntu:GNOME").
pub fn desktop_stems(names: &[String]) -> Vec<String> {
    let mut stems = Vec::new();
    for name in names.iter().flat_map(|n| n.split(':')).map(|n| n.trim().to_lowercase()).filter(|n| !n.is_empty()) {
        if let Some((_, known)) = DESKTOP_ICONS.iter().find(|(key, _)| name == *key) {
            stems.extend(known.iter().map(|s| s.to_string()));
        }
        stems.push(name);
    }
    stems
}

/// Pixel size from a "48x48" or "48" directory component; 1 when the path doesn't say.
fn icon_size(path: &Path) -> u32 {
    path.components()
        .filter_map(|c| {
            let name = c.as_os_str().to_str()?;
            let side = name.split_once('x').map_or(name, |(w, h)| if w == h { w } else { "" });
            side.parse::<u32>().ok().filter(|n| (8..=1024).contains(n))
        })
        .max()
        .unwrap_or(1)
}

/// Icon-theme folders that never hold logos (or only SVGs), skipped to keep the scan fast.
const SKIPPED_DIRS: &[&str] = &["scalable", "symbolic", "cursors", "actions", "animations", "devices", "emblems", "emotes", "mimetypes", "status", "stock", "legacy"];
/// Icons known to be smaller than this look poor scaled up on the 640px screen.
const MIN_ICON_PX: u32 = 48;

/// stem -> (size, path) for every wanted PNG under `roots`, keeping the largest size of each.
fn index_icons(roots: &[PathBuf], wanted: &HashSet<String>) -> HashMap<String, (u32, PathBuf)> {
    let mut found: HashMap<String, (u32, PathBuf)> = HashMap::new();
    let mut stack: Vec<(PathBuf, usize)> = roots.iter().map(|r| (r.clone(), 0)).collect();
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            let path = entry.path();
            // Themes link whole size folders together, so only symlinks cost a second look.
            let is_dir = kind.is_dir() || (kind.is_symlink() && path.is_dir());
            if is_dir {
                let skipped = path.file_name().and_then(|n| n.to_str()).is_some_and(|n| SKIPPED_DIRS.contains(&n));
                if depth < MAX_DEPTH && !skipped {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(str::to_lowercase) else { continue };
            if !wanted.contains(&stem) {
                continue;
            }
            let size = icon_size(&path);
            let known_small = size > 1 && size < MIN_ICON_PX;
            if known_small || std::fs::metadata(&path).map_or(true, |m| m.len() > MAX_FILE_BYTES) {
                continue;
            }
            if found.get(&stem).map_or(true, |(best, _)| size > *best) {
                found.insert(stem, (size, path));
            }
        }
    }
    found
}

fn thumbnail(path: &Path) -> Option<String> {
    let img = image::open(path).ok()?;
    let small = img.resize(THUMB_PX, THUMB_PX, image::imageops::FilterType::Lanczos3);
    let mut png = std::io::Cursor::new(Vec::new());
    small.write_to(&mut png, image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png.into_inner())))
}

fn prettify(stem: &str) -> String {
    let spaced = stem.replace(['-', '_'], " ");
    let mut chars = spaced.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

fn gpu_vendors() -> Vec<&'static str> {
    let mut vendors = Vec::new();
    for entry in std::fs::read_dir("/sys/class/drm").into_iter().flatten().flatten() {
        let Ok(id) = std::fs::read_to_string(entry.path().join("device/vendor")) else { continue };
        let vendor = match id.trim() {
            "0x10de" => "nvidia",
            "0x1002" => "amd",
            "0x8086" => "intel",
            _ => continue,
        };
        if !vendors.contains(&vendor) {
            vendors.push(vendor);
        }
    }
    vendors
}

fn cpu_vendor() -> Option<&'static str> {
    let info = std::fs::read_to_string("/proc/cpuinfo").ok()?;
    match info.lines().find_map(|l| l.strip_prefix("vendor_id"))?.split(':').nth(1)?.trim() {
        "GenuineIntel" => Some("intel"),
        "AuthenticAMD" => Some("amd"),
        _ => None,
    }
}

fn scan() -> Vec<SystemLogo> {
    let os_release = std::fs::read_to_string("/etc/os-release").or_else(|_| std::fs::read_to_string("/usr/lib/os-release")).unwrap_or_default();
    let desktops: Vec<String> = ["XDG_CURRENT_DESKTOP", "XDG_SESSION_DESKTOP", "DESKTOP_SESSION"].iter().filter_map(|k| std::env::var(k).ok()).collect();
    let mut vendors = gpu_vendors();
    let cpu = cpu_vendor().filter(|v| !vendors.contains(v));
    vendors.extend(cpu);

    let groups: Vec<(&str, Vec<String>)> = vec![
        ("Distribution", distro_stems(&os_release)),
        ("Desktop", desktop_stems(&desktops)),
        ("Hardware", vendors.iter().filter_map(|v| VENDOR_ICONS.iter().find(|(k, _)| k == v)).flat_map(|(_, s)| s.iter().map(|s| s.to_string())).collect()),
        ("Linux", KERNEL_ICONS.iter().map(|s| s.to_string()).collect()),
    ];
    let wanted: HashSet<String> = groups.iter().flat_map(|(_, stems)| stems.iter().cloned()).collect();

    let home = dirs::home_dir();
    let mut roots = vec![PathBuf::from("/usr/share/pixmaps"), PathBuf::from("/usr/share/icons"), PathBuf::from("/usr/local/share/icons")];
    roots.extend(home.iter().flat_map(|h| [h.join(".local/share/icons"), h.join(".icons")]));
    let index = index_icons(&roots, &wanted);

    let mut seen = HashSet::new();
    let mut logos = Vec::new();
    let mut add = |group: &str, stem: &str, path: &Path| {
        if logos.len() >= MAX_LOGOS || !seen.insert(path.to_path_buf()) {
            return;
        }
        if let Some(thumb) = thumbnail(path) {
            logos.push(SystemLogo { label: prettify(stem), group: group.into(), path: path.to_string_lossy().into_owned(), thumb });
        }
    };
    for (group, stems) in groups {
        for stem in stems {
            if let Some((_, path)) = index.get(&stem) {
                add(group, &stem, path);
            }
        }
    }
    for entry in std::fs::read_dir("/usr/share/pixmaps").into_iter().flatten().flatten() {
        let path = entry.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_lowercase();
        if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) && stem.contains("logo") && std::fs::metadata(&path).is_ok_and(|m| m.len() <= MAX_FILE_BYTES) {
            add("Other logos", &stem, &path);
        }
    }
    logos
}

/// Logos on this system; scanned once, then cached.
pub fn discover() -> Vec<SystemLogo> {
    static CACHE: OnceLock<Vec<SystemLogo>> = OnceLock::new();
    CACHE.get_or_init(scan).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARCH: &str = "NAME=\"Arch Linux\"\nID=arch\nLOGO=archlinux-logo\n";

    #[test]
    fn distro_stems_start_with_the_declared_logo_and_cover_id_like() {
        let stems = distro_stems(ARCH);
        assert_eq!(stems[0], "archlinux-logo");
        assert!(stems.contains(&"arch-logo".to_string()));
        let ubuntu = distro_stems("ID=pop\nID_LIKE=\"ubuntu debian\"\n");
        assert!(ubuntu.contains(&"distributor-logo-ubuntu".to_string()) && ubuntu.contains(&"debian-logo".to_string()));
    }

    #[test]
    fn desktop_names_map_to_icon_names_and_keep_the_raw_name() {
        let stems = desktop_stems(&["ubuntu:GNOME".to_string(), "Hyprland".to_string()]);
        assert!(stems.contains(&"gnome-logo".to_string()) && stems.contains(&"hyprland".to_string()) && stems.contains(&"ubuntu".to_string()));
    }

    #[test]
    fn largest_size_wins_and_unwanted_small_or_skipped_files_are_ignored() {
        let root = std::env::temp_dir().join(format!("nzxt-logos-{}", std::process::id()));
        for (dir, name) in [("hicolor/64x64/apps", "tux.png"), ("hicolor/256x256/apps", "tux.png"), ("hicolor/256x256/apps", "other.png"), ("hicolor/256x256/apps", "tux.svg"), ("hicolor/22x22/apps", "tiny.png"), ("hicolor/scalable/apps", "skipped.png")] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
            std::fs::write(root.join(dir).join(name), b"x").unwrap();
        }
        let wanted: HashSet<String> = ["tux", "tiny", "skipped"].iter().map(|s| s.to_string()).collect();
        let found = index_icons(&[root.clone()], &wanted);
        assert_eq!(found.len(), 1, "only tux: unwanted, too-small and skipped-folder files are ignored");
        assert!(found["tux"].1.to_string_lossy().contains("256x256"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn thumbnails_are_png_data_urls_and_bad_files_are_skipped() {
        let dir = std::env::temp_dir().join(format!("nzxt-logo-thumb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let good = dir.join("good.png");
        image::RgbaImage::from_pixel(300, 150, image::Rgba([255, 0, 0, 255])).save(&good).unwrap();
        let bad = dir.join("bad.png");
        std::fs::write(&bad, b"not a png").unwrap();
        assert!(thumbnail(&good).unwrap().starts_with("data:image/png;base64,"));
        assert!(thumbnail(&bad).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "inspects this machine; run with --ignored --nocapture"]
    fn discover_on_this_machine() {
        let started = std::time::Instant::now();
        let logos = discover();
        println!("{} logos in {:?}", logos.len(), started.elapsed());
        for l in &logos {
            println!("  [{}] {} -> {}", l.group, l.label, l.path);
        }
    }

    #[test]
    fn labels_are_readable() {
        assert_eq!(prettify("archlinux-logo"), "Archlinux logo");
    }
}
