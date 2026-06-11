use std::{
    fs,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

#[derive(Default)]
pub struct BrokerServiceState {
    child: Mutex<Option<Child>>,
}

impl BrokerServiceState {
    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        if Self::child_is_running(&mut child_slot)? {
            return Ok(());
        }

        let resource_dir = app.path().resource_dir().map_err(|error| {
            format!("Failed to resolve application resource directory: {error}")
        })?;
        let mosquitto_dir = resource_dir.join("mosquitto");
        let executable_path = mosquitto_dir.join("mosquitto.exe");
        let config_path = mosquitto_dir.join("mosquitto.conf");

        if !executable_path.is_file() {
            return Err(format!(
                "Mosquitto executable not found: {}",
                executable_path.display()
            ));
        }

        if !config_path.is_file() {
            return Err(format!(
                "Mosquitto config not found: {}",
                config_path.display()
            ));
        }

        let working_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("mosquitto");
        fs::create_dir_all(working_dir.join("data")).map_err(|error| {
            format!(
                "Failed to create Mosquitto data directory at {}: {error}",
                working_dir.display()
            )
        })?;

        let child = Command::new(&executable_path)
            .arg("-c")
            .arg(&config_path)
            .current_dir(&working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to start Mosquitto broker: {error}"))?;

        *child_slot = Some(child);
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

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
            .map_err(|_| "Failed to lock broker state".to_string())?;

        Self::child_is_running(&mut child_slot)
    }

    fn child_is_running(child_slot: &mut Option<Child>) -> Result<bool, String> {
        let has_exited = match child_slot.as_mut() {
            Some(child) => child
                .try_wait()
                .map_err(|error| format!("Failed to query broker status: {error}"))?
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
            .map_err(|error| format!("Failed to query broker status: {error}"))?
            .is_none()
        {
            Self::kill_child(child)?;
        }

        child
            .wait()
            .map_err(|error| format!("Failed to wait for broker shutdown: {error}"))?;
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
            .map_err(|error| format!("Failed to stop broker: {error}"))
    }

    #[cfg(not(target_os = "windows"))]
    fn kill_child(child: &mut Child) -> Result<(), String> {
        child
            .kill()
            .map_err(|error| format!("Failed to stop broker: {error}"))
    }
}

#[tauri::command]
pub fn start_broker_service(
    app: tauri::AppHandle,
    state: State<'_, BrokerServiceState>,
) -> Result<(), String> {
    state.start_with_app(&app)
}

#[tauri::command]
pub fn stop_broker_service(state: State<'_, BrokerServiceState>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn get_broker_service_status(state: State<'_, BrokerServiceState>) -> Result<bool, String> {
    state.is_running()
}
