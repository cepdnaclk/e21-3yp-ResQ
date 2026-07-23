use serde::Serialize;
use std::{
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State};

use crate::process_lifecycle::{
    assign_child_to_job, ensure_port_available_or_recover_stale, hide_window, persist_metadata,
    runtime_pid_file, terminate_managed_process, ManagedProcess,
};

#[derive(Default)]
pub struct BrokerServiceState {
    child: Mutex<Option<ManagedProcess>>,
    status: Mutex<BrokerServiceStatus>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrokerServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub state: String,
    pub message: String,
    pub details: String,
    pub log_path: Option<String>,
}

impl BrokerServiceState {
    fn set_status(&self, status: BrokerServiceStatus) {
        if let Ok(mut current) = self.status.lock() {
            *current = status;
        }
    }

    fn get_status(&self) -> BrokerServiceStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default()
    }

    fn copy_runtime_broker_files(source_dir: &Path, working_dir: &Path) -> Result<(), String> {
        fs::create_dir_all(working_dir).map_err(|error| {
            format!(
                "Failed to create broker runtime directory at {}: {error}",
                working_dir.display()
            )
        })?;

        for entry in fs::read_dir(source_dir).map_err(|error| {
            format!(
                "Failed to read Mosquitto resource directory {}: {error}",
                source_dir.display()
            )
        })? {
            let entry = entry
                .map_err(|error| format!("Failed to read Mosquitto resource entry: {error}"))?;
            let file_type = entry.file_type().map_err(|error| {
                format!(
                    "Failed to inspect Mosquitto resource entry {}: {error}",
                    entry.path().display()
                )
            })?;
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

    fn broker_log_file(app: &tauri::AppHandle) -> Result<(fs::File, std::path::PathBuf), String> {
        let log_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("logs");
        fs::create_dir_all(&log_dir).map_err(|error| {
            format!(
                "Failed to create broker log directory at {}: {error}",
                log_dir.display()
            )
        })?;

        let log_path = log_dir.join("mosquitto.log");
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| {
                format!(
                    "Failed to open broker log file at {}: {error}",
                    log_path.display()
                )
            })?;

        Ok((file, log_path))
    }

    fn broker_executable_name() -> &'static str {
        #[cfg(target_os = "windows")]
        {
            "mosquitto.exe"
        }

        #[cfg(not(target_os = "windows"))]
        {
            "mosquitto"
        }
    }

    fn packaged_broker_path(resource_dir: &Path) -> PathBuf {
        resource_dir
            .join("mosquitto")
            .join(Self::broker_executable_name())
    }

    fn wait_for_broker_ready(
        child_slot: &mut Option<ManagedProcess>,
        ports: &[u16],
    ) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut delay = Duration::from_millis(400);

        loop {
            if let Some(process) = child_slot.as_mut() {
                let Some(child) = process.child.as_mut() else {
                    return Err(
                        "Mosquitto process handle was missing while waiting for readiness."
                            .to_string(),
                    );
                };
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Mosquitto exited before the expected ports became reachable (exit status: {status})"
                    ));
                }
            }

            let mut ready = true;
            for port in ports {
                let socket_addr = format!("127.0.0.1:{port}")
                    .to_socket_addrs()
                    .map_err(|error| {
                        format!("Failed to resolve localhost for port check: {error}")
                    })?
                    .next()
                    .ok_or_else(|| format!("Failed to resolve localhost for port {port}"))?;

                if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(400)).is_err() {
                    ready = false;
                }
            }

            if ready {
                return Ok(());
            }

            if Instant::now() >= deadline {
                return Err(format!(
                    "Timed out waiting for Mosquitto TCP listeners on ports {}",
                    ports
                        .iter()
                        .map(|port| port.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }

            thread::sleep(delay);
            delay = (delay + Duration::from_millis(200)).min(Duration::from_secs(2));
        }
    }

    fn validate_packaged_resources(
        resource_dir: &Path,
    ) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
        let mosquitto_dir = resource_dir.join("mosquitto");
        let executable_path = Self::packaged_broker_path(resource_dir);
        let config_path = mosquitto_dir.join("mosquitto.conf");

        let missing = [
            (
                "Mosquitto executable",
                executable_path.is_file(),
                executable_path.clone(),
            ),
            (
                "Mosquitto config",
                config_path.is_file(),
                config_path.clone(),
            ),
        ]
        .into_iter()
        .filter_map(|(label, present, path)| {
            (!present).then(|| format!("{label}: {}", path.display()))
        })
        .collect::<Vec<_>>();

        if !missing.is_empty() {
            return Err(format!(
                "Missing packaged Mosquitto resources: {}",
                missing.join("; ")
            ));
        }

        Ok((executable_path, config_path))
    }

    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<BrokerServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        if Self::child_is_running(&mut child_slot)? {
            let status = self.get_status();
            return Ok(status);
        }

        let resource_dir = app.path().resource_dir().map_err(|error| {
            format!("Failed to resolve application resource directory: {error}")
        })?;

        let resource_status = match Self::validate_packaged_resources(&resource_dir) {
            Ok(paths) => paths,
            Err(error) => {
                let failed_status = BrokerServiceStatus {
                    running: false,
                    pid: None,
                    state: "failed".to_string(),
                    message: "Mosquitto packaged resources are missing.".to_string(),
                    details: error,
                    log_path: None,
                };
                self.set_status(failed_status.clone());
                return Err(failed_status.details);
            }
        };
        let _ = resource_status;

        let broker_pid_file = runtime_pid_file(app, "mosquitto")?;
        if let Err(error) =
            ensure_port_available_or_recover_stale(1883, "The MQTT broker", &broker_pid_file)
        {
            let failed_status = BrokerServiceStatus {
                running: false,
                pid: None,
                state: "failed".to_string(),
                message: "MQTT port 1883 is unavailable.".to_string(),
                details: error,
                log_path: None,
            };
            self.set_status(failed_status.clone());
            return Err(failed_status.details);
        }

        let websocket_pid_file = broker_pid_file.clone();
        if let Err(error) = ensure_port_available_or_recover_stale(
            9001,
            "The MQTT websocket listener",
            &websocket_pid_file,
        ) {
            let failed_status = BrokerServiceStatus {
                running: false,
                pid: None,
                state: "failed".to_string(),
                message: "MQTT websocket port 9001 is unavailable.".to_string(),
                details: error,
                log_path: None,
            };
            self.set_status(failed_status.clone());
            return Err(failed_status.details);
        }

        let working_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("mosquitto");

        let runtime_dir = working_dir.join("runtime");
        Self::copy_runtime_broker_files(&resource_dir.join("mosquitto"), &runtime_dir)?;

        fs::create_dir_all(working_dir.join("data")).map_err(|error| {
            format!(
                "Failed to create Mosquitto data directory at {}: {error}",
                working_dir.display()
            )
        })?;

        let (log_file, log_path) = Self::broker_log_file(app)?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|error| format!("Failed to clone broker log file handle: {error}"))?;

        let runtime_executable_path = runtime_dir.join(Self::broker_executable_name());
        let runtime_config_path = runtime_dir.join("mosquitto.conf");

        let starting_status = BrokerServiceStatus {
            running: true,
            pid: None,
            state: "starting".to_string(),
            message: "Mosquitto is starting.".to_string(),
            details: "Waiting for the MQTT TCP listener on port 1883 to become reachable."
                .to_string(),
            log_path: Some(log_path.display().to_string()),
        };
        self.set_status(starting_status.clone());

        let mut command = Command::new(&runtime_executable_path);
        command
            .arg("-c")
            .arg(&runtime_config_path)
            .current_dir(&runtime_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        hide_window(&mut command);

        let child = command
            .spawn()
            .map_err(|error| format!("Failed to start Mosquitto broker: {error}"))?;

        let pid = child.id();
        eprintln!("Started service: mosquitto pid={}", pid);
        let mut managed = ManagedProcess::from_child(
            "mosquitto",
            child,
            runtime_executable_path.clone(),
            vec![
                runtime_executable_path.display().to_string(),
                "-c".to_string(),
                runtime_config_path.display().to_string(),
            ],
            Some(broker_pid_file.clone()),
            vec![1883, 9001],
        );

        let child_ref = managed
            .child
            .as_ref()
            .ok_or_else(|| "Mosquitto process handle was missing after spawn.".to_string())?;
        if let Err(error) = assign_child_to_job(child_ref, "mosquitto") {
            let _ = terminate_managed_process(&mut managed);
            return Err(error);
        }
        if let Err(error) = persist_metadata(&managed) {
            let _ = terminate_managed_process(&mut managed);
            return Err(error);
        }
        *child_slot = Some(managed);

        match Self::wait_for_broker_ready(&mut child_slot, &[1883, 9001]) {
            Ok(()) => {
                let ready_status = BrokerServiceStatus {
                    running: true,
                    pid: Some(pid),
                    state: "ready".to_string(),
                    message: "Mosquitto is ready.".to_string(),
                    details: "MQTT listeners on 1883 and 9001 are reachable.".to_string(),
                    log_path: Some(log_path.display().to_string()),
                };
                self.set_status(ready_status.clone());
                Ok(ready_status)
            }
            Err(error) => {
                if let Some(mut process) = child_slot.take() {
                    let _ = terminate_managed_process(&mut process);
                }
                let failed_status = BrokerServiceStatus {
                    running: false,
                    pid: None,
                    state: "failed".to_string(),
                    message: "Mosquitto did not become ready.".to_string(),
                    details: error,
                    log_path: Some(log_path.display().to_string()),
                };
                self.set_status(failed_status.clone());
                Err(failed_status.details)
            }
        }
    }

    pub fn stop(&self) -> Result<BrokerServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        if let Some(process) = child_slot.as_mut() {
            terminate_managed_process(process)?;
        }

        *child_slot = None;
        let stopped = BrokerServiceStatus {
            running: false,
            pid: None,
            state: "stopped".to_string(),
            message: "Mosquitto is stopped.".to_string(),
            details: "The Mosquitto process was stopped.".to_string(),
            log_path: None,
        };
        self.set_status(stopped.clone());
        Ok(stopped)
    }

    pub fn is_running(&self) -> Result<BrokerServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        if Self::child_is_running(&mut child_slot)? {
            return Ok(self.get_status());
        }

        let cached = self.get_status();
        if cached.state == "starting" || cached.state == "ready" {
            let failed_status = BrokerServiceStatus {
                running: false,
                pid: None,
                state: "failed".to_string(),
                message: "Mosquitto is not available.".to_string(),
                details: cached.details.clone(),
                log_path: cached.log_path.clone(),
            };
            self.set_status(failed_status.clone());
            return Ok(failed_status);
        }

        let stopped_status = BrokerServiceStatus {
            running: false,
            pid: None,
            state: "stopped".to_string(),
            message: "Mosquitto is stopped.".to_string(),
            details: "No Mosquitto process is currently running.".to_string(),
            log_path: None,
        };
        self.set_status(stopped_status.clone());
        Ok(stopped_status)
    }

    fn child_is_running(child_slot: &mut Option<ManagedProcess>) -> Result<bool, String> {
        let has_exited = match child_slot.as_mut() {
            Some(process) => process
                .child
                .as_mut()
                .ok_or_else(|| "Broker process handle is missing".to_string())?
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
}

#[tauri::command]
pub fn start_broker_service(
    app: tauri::AppHandle,
    state: State<'_, BrokerServiceState>,
) -> Result<BrokerServiceStatus, String> {
    state.start_with_app(&app)
}

#[tauri::command]
pub fn stop_broker_service(
    state: State<'_, BrokerServiceState>,
) -> Result<BrokerServiceStatus, String> {
    state.stop()
}

#[tauri::command]
pub fn get_broker_service_status(
    state: State<'_, BrokerServiceState>,
) -> Result<BrokerServiceStatus, String> {
    state.is_running()
}
