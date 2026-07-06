use std::{
    fs,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
pub struct BrokerServiceState {
    child: Mutex<Option<Child>>,
}

impl BrokerServiceState {
    fn copy_runtime_broker_files(source_dir: &std::path::Path, working_dir: &std::path::Path) -> Result<(), String> {
        fs::create_dir_all(working_dir)
            .map_err(|error| format!("Failed to create broker runtime directory at {}: {error}", working_dir.display()))?;

        for entry in fs::read_dir(source_dir)
            .map_err(|error| format!("Failed to read Mosquitto resource directory {}: {error}", source_dir.display()))?
        {
            let entry = entry.map_err(|error| format!("Failed to read Mosquitto resource entry: {error}"))?;
            let file_type = entry.file_type().map_err(|error| format!("Failed to inspect Mosquitto resource entry {}: {error}", entry.path().display()))?;
            if !file_type.is_file() {
                continue;
            }

            let destination = working_dir.join(entry.file_name());
            fs::copy(entry.path(), &destination).map_err(|error| {
                format!(
                    "Failed to stage Mosquitto resource {} to {}: {error}",
                    entry.path().display(),
                    destination.display()
                )
            })?;
        }

        Ok(())
    }

    fn broker_log_file(app: &tauri::AppHandle) -> Result<fs::File, String> {
        let log_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("logs");
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("Failed to create broker log directory at {}: {error}", log_dir.display()))?;

        let log_path = log_dir.join("mosquitto.log");
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("Failed to open broker log file at {}: {error}", log_path.display()))
    }

    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        if Self::child_is_running(&mut child_slot)? {
            return Ok(());
        }

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Failed to resolve application resource directory: {error}"))?;

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

        let runtime_dir = working_dir.join("runtime");
        Self::copy_runtime_broker_files(&mosquitto_dir, &runtime_dir)?;

        fs::create_dir_all(working_dir.join("data")).map_err(|error| {
            format!(
                "Failed to create Mosquitto data directory at {}: {error}",
                working_dir.display()
            )
        })?;

        eprintln!("Broker executable path: {}", executable_path.display());
        eprintln!("Broker working directory: {}", runtime_dir.display());
        let log_file = Self::broker_log_file(app)?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|error| format!("Failed to clone broker log file handle: {error}"))?;

        let runtime_executable_path = runtime_dir.join("mosquitto.exe");
        let runtime_config_path = runtime_dir.join("mosquitto.conf");

        let mut command = Command::new(&runtime_executable_path);
        command
            .arg("-c")
            .arg(&runtime_config_path)
            .current_dir(&runtime_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        Self::hide_window(&mut command);

        let child = command
            .spawn()
            .map_err(|error| format!("Failed to start Mosquitto broker: {error}"))?;

        let pid = child.id();
        eprintln!("Broker process spawned with PID: {}", pid);

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

    fn hide_window(command: &mut Command) {
        #[cfg(target_os = "windows")]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
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

        let mut taskkill = Command::new("taskkill");
        taskkill
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        Self::hide_window(&mut taskkill);

        let taskkill_result = taskkill.status();

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