//! Command-line interface. A second `nzxtcam-v1 …` invocation forwards its args to the running instance.

use crate::commands::AppState;
use crate::{config, image_io, render};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Manager};

/// Whether this instance's window should open once the UI has painted.
pub static START_VISIBLE: AtomicBool = AtomicBool::new(true);

pub const USAGE: &str = "\
Usage: nzxtcam-v1 [OPTIONS]

Runs the app, or sends the options to the instance that is already running.

LCD:
  --lcd-image <path>          Show a still image
  --lcd-gif <path>            Play a GIF
  --lcd-color <#rrggbb>       Fill with a solid colour
  --lcd-temps                 Switch to the temperature display
  --lcd-background <path|none>
                              Photo/GIF behind the temperature display (switches to it)
  --lcd-dim <0-90>            Darken the background image by this percentage
  --rotation <0|90|180|270>   Rotate the LCD to match how the cooler is mounted
  --profile <name>            Apply a saved profile
  --lcd-config <file.json>    Load a display layout (DisplayConfig JSON), validate, apply and keep it
  --export-lcd-config <file.json>
                              Write the current display layout to a file

Window:
  --show                      Open the window
  --hidden                    Start in the tray without opening the window
  --quit                      Quit the running instance

  -h, --help                  Show this help

Any LCD option implies --hidden when the app is not already running.";

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Image(PathBuf),
    Gif(PathBuf),
    Color(u8, u8, u8),
    Temps,
    Background(Option<PathBuf>),
    Dim(u8),
    Rotation(u16),
    Profile(String),
    LcdConfig(PathBuf),
    ExportLcdConfig(PathBuf),
    Show,
    Quit,
}

#[derive(Debug, Default, PartialEq)]
pub struct Cli {
    pub actions: Vec<Action>,
    pub hidden: bool,
    pub help: bool,
}

impl Cli {
    /// Whether a fresh instance should open its window.
    pub fn starts_visible(&self) -> bool {
        !self.hidden && self.actions.iter().all(|a| matches!(a, Action::Show))
    }
}

fn parse_hex(s: &str) -> Option<(u8, u8, u8)> {
    let h = s.strip_prefix('#').unwrap_or(s);
    if h.len() != 6 {
        return None;
    }
    let byte = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    Some((byte(0)?, byte(2)?, byte(4)?))
}

/// Parse args (without argv[0]); relative paths resolve against `cwd`.
pub fn parse(args: &[String], cwd: &Path) -> Result<Cli, String> {
    let mut cli = Cli::default();
    let mut it = args.iter();
    let path = |v: &String| cwd.join(v);
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{arg} needs a value"));
        let action = match arg.as_str() {
            "-h" | "--help" => { cli.help = true; continue }
            "--hidden" => { cli.hidden = true; continue }
            "--show" => Action::Show,
            "--quit" => Action::Quit,
            "--lcd-temps" => Action::Temps,
            "--lcd-image" => Action::Image(path(value()?)),
            "--lcd-gif" => Action::Gif(path(value()?)),
            "--lcd-color" => {
                let v = value()?;
                let (r, g, b) = parse_hex(v).ok_or_else(|| format!("--lcd-color expects #rrggbb, got {v}"))?;
                Action::Color(r, g, b)
            }
            "--lcd-background" => {
                let v = value()?;
                Action::Background((v != "none").then(|| path(v)))
            }
            "--lcd-dim" => {
                let v = value()?;
                Action::Dim(v.parse().ok().filter(|d| *d <= 90).ok_or_else(|| format!("--lcd-dim expects 0-90, got {v}"))?)
            }
            "--rotation" => {
                let v = value()?;
                Action::Rotation(v.parse().ok().filter(|d| [0, 90, 180, 270].contains(d)).ok_or_else(|| format!("--rotation expects 0, 90, 180 or 270, got {v}"))?)
            }
            "--profile" => Action::Profile(value()?.clone()),
            "--lcd-config" => Action::LcdConfig(path(value()?)),
            "--export-lcd-config" => Action::ExportLcdConfig(path(value()?)),
            other => return Err(format!("Unknown option: {other}")),
        };
        cli.actions.push(action);
    }
    Ok(cli)
}

/// Read and validate a DisplayConfig JSON file; errors name the file and the problem.
fn read_lcd_config(p: &Path) -> anyhow::Result<crate::types::DisplayConfig> {
    let s = std::fs::read_to_string(p).map_err(|e| anyhow::anyhow!("{}: {e}", p.display()))?;
    parse_lcd_config(&s, &p.display().to_string())
}

fn parse_lcd_config(json: &str, origin: &str) -> anyhow::Result<crate::types::DisplayConfig> {
    let cfg: crate::types::DisplayConfig = serde_json::from_str(json)
        .map_err(|e| anyhow::anyhow!("{origin}: invalid layout at line {}, column {}: {e}", e.line(), e.column()))?;
    cfg.validate().map_err(|e| anyhow::anyhow!("{origin}: {e}"))?;
    Ok(cfg)
}

fn show_window(app: &AppHandle, visible: bool) {
    let driver = &app.state::<AppState>().driver;
    driver.set_window_visible(visible);
    if let Some(win) = app.get_webview_window("main") {
        let _ = if visible { win.show().and_then(|_| win.set_focus()) } else { win.hide() };
    }
}

fn start_temps(app: &AppHandle) -> anyhow::Result<()> {
    app.state::<AppState>().driver.start_temp_mode(render::render_for_device)?;
    config::update(|c| c.last_mode = Some("temperatures".into()))?;
    Ok(())
}

fn update_display(app: &AppHandle, f: impl FnOnce(&mut crate::types::DisplayConfig)) -> anyhow::Result<()> {
    let driver = &app.state::<AppState>().driver;
    let mut cfg = driver.get_display_config();
    f(&mut cfg);
    driver.set_display_config(cfg.clone());
    config::update(|c| c.display_config = Some(cfg))?;
    Ok(())
}

async fn apply(app: &AppHandle, action: Action) -> anyhow::Result<()> {
    let driver = app.state::<AppState>().driver.clone();
    let path_str = |p: &Path| p.to_string_lossy().into_owned();
    match action {
        Action::Image(p) => {
            let rgba = image_io::image_to_device_rgba(&tokio::fs::read(&p).await?)?;
            driver.send_rgba_image(rgba).await?;
            config::update(|c| { c.last_mode = Some("image".into()); c.last_image_path = Some(path_str(&p)) })?;
        }
        Action::Gif(p) => {
            let bytes = tokio::fs::read(&p).await?;
            let gif = tokio::task::spawn_blocking(move || image_io::resize_gif(&bytes)).await??;
            driver.send_gif(gif).await?;
            config::update(|c| { c.last_mode = Some("gif".into()); c.last_gif_path = Some(path_str(&p)) })?;
        }
        Action::Color(r, g, b) => {
            driver.send_color(r, g, b).await?;
            config::update(|c| { c.last_mode = Some("color".into()); c.last_color = Some(config::LastColor { r, g, b }) })?;
        }
        Action::Temps => start_temps(app)?,
        Action::Background(p) => {
            if let Some(p) = &p {
                anyhow::ensure!(p.is_file(), "Background not found: {}", p.display());
            }
            update_display(app, |cfg| cfg.background_image = p.as_deref().map(path_str))?;
            start_temps(app)?;
        }
        Action::Dim(d) => update_display(app, |cfg| cfg.background_dim = d)?,
        Action::Rotation(deg) => {
            image_io::set_lcd_rotation(deg);
            config::update(|c| c.lcd_rotation = deg)?;
            driver.refresh_display();
        }
        Action::LcdConfig(p) => {
            let cfg = read_lcd_config(&p)?;
            update_display(app, |c| *c = cfg)?;
            start_temps(app)?;
        }
        Action::ExportLcdConfig(p) => {
            let json = serde_json::to_string_pretty(&driver.get_display_config())?;
            config::write_atomic(&p, json.as_bytes(), false)?;
        }
        Action::Profile(name) => crate::apply_profile_to_driver(&crate::profile::load_profile(&name)?, &driver).await?,
        Action::Show => show_window(app, true),
        Action::Quit => app.exit(0),
    }
    Ok(())
}

pub async fn run_actions(app: AppHandle, actions: Vec<Action>) {
    for action in actions {
        let label = format!("{action:?}");
        if let Err(e) = apply(&app, action).await {
            log::warn!("CLI {label} failed: {e}");
        }
    }
}

/// Handle args forwarded from a second `nzxtcam-v1` invocation.
pub fn forward(app: &AppHandle, argv: Vec<String>, cwd: String) {
    match parse(argv.get(1..).unwrap_or_default(), Path::new(&cwd)) {
        Ok(cli) => {
            let mut actions = cli.actions;
            if actions.is_empty() && !cli.hidden {
                actions.push(Action::Show); // plain relaunch brings the window back
            }
            tauri::async_runtime::spawn(run_actions(app.clone(), actions));
        }
        Err(e) => log::warn!("Ignoring forwarded args: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn parses_pipeline_invocation() {
        let cli = parse(&args("--lcd-background wall.png --lcd-dim 30 --rotation 270"), Path::new("/home/u")).unwrap();
        assert_eq!(cli.actions, vec![
            Action::Background(Some(PathBuf::from("/home/u/wall.png"))),
            Action::Dim(30),
            Action::Rotation(270),
        ]);
        assert!(!cli.starts_visible());
    }

    #[test]
    fn absolute_paths_and_none_are_kept() {
        let cli = parse(&args("--lcd-gif /tmp/a.gif --lcd-background none --lcd-color #FF8000"), Path::new("/x")).unwrap();
        assert_eq!(cli.actions, vec![Action::Gif("/tmp/a.gif".into()), Action::Background(None), Action::Color(255, 128, 0)]);
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse(&args("--rotation 45"), Path::new("/")).is_err());
        assert!(parse(&args("--lcd-dim 95"), Path::new("/")).is_err());
        assert!(parse(&args("--lcd-color red"), Path::new("/")).is_err());
        assert!(parse(&args("--lcd-image"), Path::new("/")).is_err());
        assert!(parse(&args("--bogus"), Path::new("/")).is_err());
    }

    #[test]
    fn parses_lcd_config_flags() {
        let cli = parse(&args("--lcd-config a.json --export-lcd-config /tmp/b.json"), Path::new("/h")).unwrap();
        assert_eq!(cli.actions, vec![Action::LcdConfig("/h/a.json".into()), Action::ExportLcdConfig("/tmp/b.json".into())]);
        assert!(parse(&args("--lcd-config"), Path::new("/")).is_err());
    }

    #[test]
    fn lcd_config_validation() {
        assert!(parse_lcd_config(r##"{"background":"#000","elements":[]}"##, "f").is_ok());
        let e = parse_lcd_config("{", "f.json").unwrap_err().to_string();
        assert!(e.contains("f.json") && e.contains("line"), "{e}");
        let e = parse_lcd_config(r##"{"background":"#000","elements":[],"backgroundDim":99}"##, "f.json").unwrap_err().to_string();
        assert!(e.contains("backgroundDim"), "{e}");
    }

    #[test]
    fn visibility() {
        assert!(parse(&[], Path::new("/")).unwrap().starts_visible());
        assert!(parse(&args("--show"), Path::new("/")).unwrap().starts_visible());
        assert!(!parse(&args("--hidden"), Path::new("/")).unwrap().starts_visible());
        assert!(!parse(&args("--lcd-temps"), Path::new("/")).unwrap().starts_visible());
    }
}
