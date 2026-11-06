//! Autostart: systemd user service plus an XDG autostart entry for desktops that don't run `systemd --user`.

use crate::commands::to_str_err;

const SERVICE_NAME: &str = "nzxtcam-v1.service";

fn quote_exec_path(path: &str, escape: fn(char) -> Option<&'static str>) -> Result<String, String> {
    if path.contains(['\n', '\r']) {
        return Err("Binary path contains a line break".into());
    }
    let mut quoted = String::from("\"");
    for c in path.chars() {
        match escape(c) {
            Some(replacement) => quoted.push_str(replacement),
            None => quoted.push(c),
        }
    }
    quoted.push('"');
    Ok(quoted)
}

fn escape_for_systemd(c: char) -> Option<&'static str> {
    match c {
        '"' => Some("\\\""),
        '\\' => Some("\\\\"),
        '%' => Some("%%"),
        '$' => Some("$$"),
        _ => None,
    }
}

fn escape_for_desktop_entry(c: char) -> Option<&'static str> {
    match c {
        '"' => Some("\\\""),
        '`' => Some("\\`"),
        '$' => Some("\\$"),
        '\\' => Some("\\\\"),
        '%' => Some("%%"),
        _ => None,
    }
}

fn run_systemctl_user(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("systemctl: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!("systemctl --user {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim()))
}

#[tauri::command]
pub fn get_autostart() -> bool {
    let Some(home) = dirs::home_dir() else { return false };
    home.join(".config/systemd/user").join(SERVICE_NAME).exists()
        || home.join(".config/autostart/nzxtcam-v1.desktop").exists()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Home dir not found")?;
    let service_dir = home.join(".config/systemd/user");
    let service_path = service_dir.join(SERVICE_NAME);
    let xdg_dir = home.join(".config/autostart");
    let xdg_path = xdg_dir.join("nzxtcam-v1.desktop");

    if !enabled {
        let _ = run_systemctl_user(&["disable", SERVICE_NAME]);
        for path in [&service_path, &xdg_path] {
            match std::fs::remove_file(path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("{}: {e}", path.display())),
                _ => {}
            }
        }
        return Ok(());
    }

    let exe = std::env::current_exe().map_err(to_str_err)?;
    let exe = exe.to_string_lossy();
    let systemd_exe = quote_exec_path(&exe, escape_for_systemd)?;
    let desktop_exe = quote_exec_path(&exe, escape_for_desktop_entry)?;

    std::fs::create_dir_all(&xdg_dir).map_err(to_str_err)?;
    std::fs::write(&xdg_path, format!(
        "[Desktop Entry]\nType=Application\nName=nzxtcam-v1\n\
         Exec={desktop_exe}\nIcon=nzxtcam-v1\nHidden=false\n\
         NoDisplay=false\nX-GNOME-Autostart-enabled=true\n"
    )).map_err(to_str_err)?;

    std::fs::create_dir_all(&service_dir).map_err(to_str_err)?;
    std::fs::write(&service_path, format!(
        "[Unit]\nDescription=NZXT CAM v1 — LCD Controller\nAfter=graphical-session.target\n\n\
         [Service]\nType=simple\nExecStart={systemd_exe}\nRestart=on-failure\nRestartSec=3\n\n\
         [Install]\nWantedBy=graphical-session.target\n"
    )).map_err(to_str_err)?;
    run_systemctl_user(&["daemon-reload"])?;
    run_systemctl_user(&["enable", SERVICE_NAME])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_paths_are_quoted_and_escaped() {
        assert_eq!(quote_exec_path("/opt/my app/bin", escape_for_systemd).unwrap(), "\"/opt/my app/bin\"");
        assert_eq!(quote_exec_path("/a%b$c\"d", escape_for_systemd).unwrap(), "\"/a%%b$$c\\\"d\"");
        assert_eq!(quote_exec_path("/a`b$c", escape_for_desktop_entry).unwrap(), "\"/a\\`b\\$c\"");
        assert!(quote_exec_path("/a\nb", escape_for_systemd).is_err());
    }
}
