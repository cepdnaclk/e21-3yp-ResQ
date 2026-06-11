use std::{
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

#[derive(Default)]
pub struct ApiServiceState {
    child: Mutex<Option<Child>>,
}

impl ApiServiceState {
    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        if Self::child_is_running(&mut child_slot)? {
            return Ok(());
        }

        let resource_dir = app.path().resource_dir().map_err(|error| {
            format!("Failed to resolve application resource directory: {error}")
        })?;
        let jar_path = resource_dir.join("hub-api").join("resq-hub-api.jar");
        let config_path = resource_dir
            .join("config")
            .join("application-release.properties");

        if !jar_path.is_file() {
            return Err(format!("Backend JAR not found: {}", jar_path.display()));
        }

        if !config_path.is_file() {
            return Err(format!(
                "Backend config not found: {}",
                config_path.display()
            ));
        }

        let child = Command::new("java")
            .arg("-jar")
            .arg(&jar_path)
            .arg(format!(
                "--spring.config.location={}",
                config_path.display()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!("Failed to start backend API. Is Java installed? Error: {error}")
            })?;

        *child_slot = Some(child);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        if let Some(child) = child_slot.as_mut() {
            Self::terminate_child(child)?;
        }

        *child_slot = None;
        Ok(())
    }

    pub fn is_running(&self) -> Result<bool, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        Self::child_is_running(&mut child_slot)
    }

    fn child_is_running(child_slot: &mut Option<Child>) -> Result<bool, String> {
        let has_exited = match child_slot.as_mut() {
            Some(child) => child
                .try_wait()
                .map_err(|error| format!("Failed to query backend status: {error}"))?
                .is_some(),
            None => false,
        };

        if has_exited {
            *child_slot = None;
        }

        Ok(child_slot.is_some())
    }

    fn terminate_child(child: &mut Child) -> Result<(), String> {
        if child
            .try_wait()
            .map_err(|error| format!("Failed to query backend status: {error}"))?
            .is_none()
        {
            Self::kill_child(child)?;
        }

        child
            .wait()
            .map_err(|error| format!("Failed to wait for backend shutdown: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn kill_child(child: &mut Child) -> Result<(), String> {
        let pid = child.id().to_string();
        let taskkill_result = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if matches!(taskkill_result, Ok(status) if status.success()) {
            return Ok(());
        }

        child
            .kill()
            .map_err(|error| format!("Failed to stop backend: {error}"))
    }

    #[cfg(not(target_os = "windows"))]
    fn kill_child(child: &mut Child) -> Result<(), String> {
        child
            .kill()
            .map_err(|error| format!("Failed to stop backend: {error}"))
    }
}

#[tauri::command]
pub fn start_api_service(
    app: tauri::AppHandle,
    state: State<'_, ApiServiceState>,
) -> Result<(), String> {
    state.start_with_app(&app)
}

#[tauri::command]
pub fn stop_api_service(state: State<'_, ApiServiceState>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn get_api_service_status(state: State<'_, ApiServiceState>) -> Result<bool, String> {
    state.is_running()
}
