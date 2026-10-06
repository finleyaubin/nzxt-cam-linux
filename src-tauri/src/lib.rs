//! Library crate — exposes `run()` which is called from main.rs.

pub mod cli;
pub mod commands;
pub mod config;
pub mod fans;
pub mod image_io;
pub mod profile;
pub mod render;
pub mod sensors;
pub mod types;
pub mod usb;

use commands::AppState;
use parking_lot::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Verbose logging in dev, info-only in release.
    let log_level = if cfg!(debug_assertions) { "debug" } else { "info" };
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(log_level)).init();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let cli = match cli::parse(&args, &std::env::current_dir().unwrap_or_default()) {
        Ok(cli) => cli,
        Err(e) => {
            eprintln!("{e}\n\n{}", cli::USAGE);
            std::process::exit(2);
        }
    };
    if cli.help {
        println!("{}", cli::USAGE);
        return;
    }
    cli::START_VISIBLE.store(cli.starts_visible(), std::sync::atomic::Ordering::Relaxed);

    // Build the driver and seed runtime state from persisted config.
    let driver = usb::KrakenDriver::new();
    let settings = config::load_settings();
    sensors::set_gpu_source(settings.gpu_source.clone());
    sensors::set_sensor_sources(settings.cpu_source.clone(), settings.sensor_sources());
    driver.set_temp_timing(settings.lcd_poll_ms, settings.lcd_min_push_ms);

    // Apply persisted display config (or leave the default).
    if let Some(mut dc) = config::load_display_config() {
        if dc.decimals == 0 {
            dc.decimals = settings.decimals;
        }
        driver.set_display_config(dc);
    } else {
        let mut dc = types::DisplayConfig::default();
        dc.decimals = settings.decimals;
        driver.set_display_config(dc);
    }

    let state = AppState {
        driver: driver.clone(),
        gpu_fan: crate::fans::GpuFanController::new(),
        temp_poll_shutdown: Mutex::new(None),
    };

    tauri::Builder::default()
        // Must be the first plugin: later launches forward their args here and exit.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| cli::forward(app, argv, cwd)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
            _ => {}
        })
        .setup(move |app| {
            // Wire up the driver's callbacks so it can emit Tauri events.
            commands::setup_callbacks(&app.handle(), &driver);
            image_io::set_lcd_rotation(config::load().lcd_rotation);

            // Tray icon — left click toggles window, right click shows menu.
            let show_item = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event({
                    let driver = driver.clone();
                    move |tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    driver.set_window_visible(false);
                                    let _ = win.emit("window-visibility", false);
                                    let _ = win.hide();
                                } else {
                                    driver.set_window_visible(true);
                                    let _ = win.emit("window-visibility", true);
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                    }
                })
                .on_menu_event({
                    let driver = driver.clone();
                    move |app, event| match event.id.as_ref() {
                        "show" => {
                            driver.set_window_visible(true);
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.emit("window-visibility", true);
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .build(app)?;

            if !cli.starts_visible() {
                driver.set_window_visible(false);
            }
            let driver_for_connect = driver.clone();
            let handle = app.handle().clone();
            let actions = cli.actions.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = driver_for_connect.connect().await {
                    log::info!("Auto-connect at startup failed: {}", e);
                }
                cli::run_actions(handle, actions).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect_device,
            commands::get_device_status,
            commands::send_color,
            commands::send_image,
            commands::send_gif,
            commands::start_temp_mode,
            commands::stop_current_mode,
            commands::get_temperatures,
            commands::start_temp_polling,
            commands::stop_temp_polling,
            commands::get_display_config,
            commands::save_display_config,
            commands::render_display_preview,
            commands::list_gpu_sources,
            commands::list_sensors,
            commands::start_visible,
            commands::save_giphy_gif,
            commands::get_settings,
            commands::save_settings,
            commands::open_external,
            commands::get_config,
            commands::save_config,
            commands::set_pump_profile,
            commands::set_lcd_orientation,
            commands::get_gpu_fan_status,
            commands::set_gpu_fan_curve,
            commands::set_gpu_fan_auto,
            commands::list_fan_channels,
            commands::read_fan_channels,
            commands::set_fan_duty_cmd,
            commands::set_fan_auto_cmd,
            commands::send_ring,
            commands::list_profiles,
            commands::save_profile_cmd,
            commands::delete_profile_cmd,
            commands::get_profile,
            commands::apply_profile,
            commands::quit_app,
            commands::hide_window,
            commands::show_window,
            commands::get_autostart,
            commands::set_autostart,
        ])
        .run(tauri::generate_context!())
        .expect("error while starting Tauri");
}

/// Apply a profile directly via the driver (used at startup, before Tauri State is accessible).
async fn apply_profile_to_driver(
    p: &profile::Profile,
    driver: &usb::KrakenDriver,
) -> anyhow::Result<()> {
    use profile::ProfileLcd;

    if let Some(ref ring) = p.ring {
        let _ = driver.send_ring_lighting(ring.channel, ring.mode.clone()).await;
    }

    match &p.lcd {
        ProfileLcd::None => {}
        ProfileLcd::Color { r, g, b } => {
            driver.send_color(*r, *g, *b).await?;
        }
        ProfileLcd::Image { path } => {
            let bytes = tokio::fs::read(path).await?;
            let rgba = image_io::image_to_device_rgba(&bytes)?;
            driver.send_rgba_image(rgba).await?;
        }
        ProfileLcd::Gif { path } => {
            let bytes = tokio::fs::read(path).await?;
            let resized = tokio::task::spawn_blocking(move || image_io::resize_gif(&bytes)).await??;
            driver.send_gif(resized).await?;
        }
        ProfileLcd::Temperatures => {
            driver.start_temp_mode(|cfg, temps| render::render_for_device(cfg, temps))?;
        }
    }

    if let Some(ref dc) = p.display_config {
        driver.set_display_config(dc.clone());
    }

    Ok(())
}
