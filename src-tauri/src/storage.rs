//! Mounted block-device usage from /proc/mounts + statvfs.

use serde::Serialize;
use std::collections::HashSet;
use std::ffi::CString;
use std::fs;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub device: String,
    pub mount: String,
    pub used_bytes: u64,
    pub total_bytes: u64,
}

fn unescape_mount_field(field: &str) -> String {
    field.replace("\\040", " ").replace("\\011", "\t").replace("\\134", "\\")
}

fn usage(mount: &str) -> Result<(u64, u64), String> {
    let path = CString::new(mount).map_err(|e| format!("{mount}: {e}"))?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a valid NUL-terminated string and `stat` is only read after statvfs succeeds.
    let rc = unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) };
    if rc != 0 {
        return Err(format!("statvfs {mount}: {}", std::io::Error::last_os_error()));
    }
    let stat = unsafe { stat.assume_init() };
    let block = stat.f_frsize;
    let total = stat.f_blocks * block;
    let used = total - stat.f_bfree * block;
    Ok((used, total))
}

pub fn list_drives() -> Result<Vec<Drive>, String> {
    let mounts = fs::read_to_string("/proc/mounts").map_err(|e| format!("/proc/mounts: {e}"))?;
    let mut seen_devices = HashSet::new();
    let mut drives = Vec::new();
    for line in mounts.lines() {
        let mut fields = line.split_whitespace();
        let (Some(device), Some(mount)) = (fields.next(), fields.next()) else { continue };
        let is_physical = device.starts_with("/dev/") && !device.starts_with("/dev/loop");
        // Bind mounts and btrfs subvolumes repeat the same device.
        if !is_physical || !seen_devices.insert(device.to_string()) {
            continue;
        }
        let mount = unescape_mount_field(mount);
        // One stale or inaccessible mount must not hide every other drive.
        let (used_bytes, total_bytes) = match usage(&mount) {
            Ok(sizes) => sizes,
            Err(e) => {
                log::warn!("Skipping drive: {e}");
                continue;
            }
        };
        if total_bytes > 0 {
            drives.push(Drive { device: device.to_string(), mount, used_bytes, total_bytes });
        }
    }
    Ok(drives)
}
