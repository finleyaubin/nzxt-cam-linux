//! Tauri commands for GPU and case fan control.

use crate::commands::{AppState, CommandResult};
use serde::Deserialize;
use tauri::State;


#[tauri::command]
pub fn get_gpu_fan_status(state: State<'_, AppState>) -> Option<crate::fans::GpuFanStatus> {
    state.gpu_fan.get_status()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuFanCurvePoint { pub t: u8, pub s: u8 }

#[tauri::command]
pub fn set_gpu_fan_curve(points: Vec<GpuFanCurvePoint>, state: State<'_, AppState>) -> CommandResult {
    let pairs: Vec<(u8, u8)> = points.into_iter().map(|p| (p.t, p.s)).collect();
    match state.gpu_fan.set_curve(pairs) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

#[tauri::command]
pub fn set_gpu_fan_auto(state: State<'_, AppState>) -> CommandResult {
    match state.gpu_fan.set_auto() {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

// ============================================================================
// Fan control (hwmon sysfs — boitier)
// ============================================================================

#[tauri::command]
pub fn list_drives() -> Result<Vec<crate::storage::Drive>, String> {
    crate::storage::list_drives()
}

#[tauri::command]
pub fn list_fan_channels() -> Vec<crate::fans::FanChannel> {
    crate::fans::list_fan_channels()
}

#[tauri::command]
pub fn read_fan_channels() -> Vec<crate::fans::FanChannel> {
    crate::fans::list_fan_channels()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFanDutyArgs {
    pub hwmon_path: String,
    pub pwm_index: u8,
    pub duty: u8,
}

#[tauri::command]
pub fn set_fan_duty_cmd(args: SetFanDutyArgs) -> CommandResult {
    match crate::fans::set_fan_duty(&args.hwmon_path, args.pwm_index, args.duty) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFanAutoArgs {
    pub hwmon_path: String,
    pub pwm_index: u8,
}

#[tauri::command]
pub fn set_fan_auto_cmd(args: SetFanAutoArgs) -> CommandResult {
    match crate::fans::set_fan_auto(&args.hwmon_path, args.pwm_index) {
        Ok(_) => CommandResult::ok(),
        Err(e) => CommandResult::fail(e),
    }
}
