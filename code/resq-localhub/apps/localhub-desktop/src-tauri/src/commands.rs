use serde::Serialize;

#[derive(Serialize)]
pub struct AppInfo {
    app_name: String,
    app_version: String,
    platform: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        app_name: "ResQ Local Hub".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}
