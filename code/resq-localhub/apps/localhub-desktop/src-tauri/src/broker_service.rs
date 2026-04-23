use serde::Serialize;
use std::{
    collections::HashSet,
    env,
    net::{SocketAddr, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::State;

#[derive(Default)]
pub struct BrokerServiceState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize, Clone)]
pub struct BrokerServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub message: String,
}

const BROKER_CONF_RELATIVE_PATH: &str = "../../../infra/mosquitto/mosquitto.conf";

impl BrokerServiceState {
    fn is_port_in_use(port: u16) -> bool {
        let ipv4_addr = SocketAddr::from(([127, 0, 0, 1], port));
        let ipv6_addr = SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port));

        TcpListener::bind(ipv4_addr).is_err() || TcpListener::bind(ipv6_addr).is_err()
    }

    fn snapshot_status(child_slot: &mut Option<Child>) -> BrokerServiceStatus {
        if let Some(child) = child_slot.as_mut() {
            if matches!(child.try_wait(), Ok(Some(_))) {
                *child_slot = None;
            }
        }

        match child_slot.as_ref() {
            Some(child) => BrokerServiceStatus {
                running: true,
                pid: Some(child.id()),
                message: "Broker process is running.".to_string(),
            },
            None => BrokerServiceStatus {
                running: Self::is_port_in_use(1883),
                pid: None,
                message: if Self::is_port_in_use(1883) {
                    "Broker appears to be running externally on port 1883.".to_string()
                } else {
                    "Broker process is stopped.".to_string()
                },
            },
        }
    }

    fn resolve_broker_conf_path() -> Result<PathBuf, String> {
        if let Ok(path) = env::var("MOSQUITTO_CONF") {
            let conf_path = PathBuf::from(path);
            if conf_path.exists() {
                return Ok(conf_path);
            }

            return Err(format!(
                "Config file not found (MOSQUITTO_CONF): {}",
                conf_path.display()
            ));
        }

        let default_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BROKER_CONF_RELATIVE_PATH);
        if default_path.exists() {
            return Ok(default_path);
        }

        Err(format!("Config file not found: {}", default_path.display()))
    }

    fn resolve_broker_commands() -> Vec<String> {
        if let Ok(path) = env::var("MOSQUITTO_EXE") {
            return vec![path];
        }

        #[cfg(target_os = "windows")]
        {
            let mut candidates = vec!["mosquitto".to_string()];

            if let Ok(program_files) = env::var("ProgramFiles") {
                candidates.push(
                    PathBuf::from(program_files)
                        .join("Mosquitto")
                        .join("mosquitto.exe")
                        .to_string_lossy()
                        .to_string(),
                );
            }

            if let Ok(program_files_x86) = env::var("ProgramFiles(x86)") {
                candidates.push(
                    PathBuf::from(program_files_x86)
                        .join("Mosquitto")
                        .join("mosquitto.exe")
                        .to_string_lossy()
                        .to_string(),
                );
            }

            // Keep a static fallback in case env vars are not available.
            candidates.push(r"C:\Program Files\Mosquitto\mosquitto.exe".to_string());

            let mut seen = HashSet::new();
            candidates.retain(|candidate| seen.insert(candidate.clone()));
            candidates
        }

        #[cfg(not(target_os = "windows"))]
        {
            vec!["mosquitto".to_string()]
        }
    }

    fn build_command(program: &str, conf_path: &Path) -> Command {
        let mut command = Command::new(program);

        command
            .arg("-c")
            .arg(conf_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        command
    }

    fn start(&self) -> Result<BrokerServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        let current_status = Self::snapshot_status(&mut child_slot);
        if current_status.running {
            return Ok(BrokerServiceStatus {
                message: "Broker is already running (tracked process or external listener on port 1883).".to_string(),
                ..current_status
            });
        }

        let conf_path = Self::resolve_broker_conf_path()?;
        let programs = Self::resolve_broker_commands();

        let mut child = None;
        let mut last_error = None;

        for program in &programs {
            let mut command = Self::build_command(program, &conf_path);
            match command.spawn() {
                Ok(spawned_child) => {
                    child = Some(spawned_child);
                    break;
                }
                Err(error) => {
                    last_error = Some((program.clone(), error.to_string()));
                }
            }
        }

        let mut child = child.ok_or_else(|| {
            let (program, error) = last_error.unwrap_or_else(|| {
                (
                    "mosquitto".to_string(),
                    "Unknown process spawn error".to_string(),
                )
            });
            Self::map_start_error(error, &program, &programs, &conf_path)
        })?;

        // Give the process a short moment; if it exits immediately, report a helpful error.
        thread::sleep(Duration::from_millis(400));
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Failed to start broker: process exited early (code: {:?}). The config may be invalid or port 1883 is already in use.",
                status.code()
            ));
        }

        let pid = child.id();
        *child_slot = Some(child);

        Ok(BrokerServiceStatus {
            running: true,
            pid: Some(pid),
            message: format!("Broker started using config: {}", conf_path.display()),
        })
    }

    fn stop(&self) -> Result<BrokerServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock broker state".to_string())?;

        let current_status = Self::snapshot_status(&mut child_slot);
        if !current_status.running {
            return Ok(BrokerServiceStatus {
                message: "Broker is already stopped.".to_string(),
                ..current_status
            });
        }

        if child_slot.is_none() {
            return Ok(BrokerServiceStatus {
                running: true,
                pid: None,
                message: "Broker is running externally and is not managed by this app. Stop it from your system service/process manager.".to_string(),
            });
        }

        if let Some(mut child) = child_slot.take() {
            Self::terminate_child(&mut child)?;
        }

        Ok(BrokerServiceStatus {
            running: false,
            pid: None,
            message: "Broker stopped.".to_string(),
        })
    }

    fn terminate_child(child: &mut Child) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let pid = child.id().to_string();
            let status = Command::new("taskkill")
                .args(["/PID", &pid, "/T", "/F"])
                .status()
                .map_err(|error| format!("Failed to stop broker: {error}"))?;

            if !status.success() {
                return Err("Failed to stop broker with taskkill".to_string());
            }

            let _ = child.wait();
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            child
                .kill()
                .map_err(|error| format!("Failed to stop broker: {error}"))?;
            let _ = child.wait();
            Ok(())
        }
    }

    fn map_start_error(
        error: String,
        attempted_program: &str,
        attempted_programs: &[String],
        conf_path: &Path,
    ) -> String {
        let executable_hint = if env::var("MOSQUITTO_EXE").is_ok() {
            "MOSQUITTO_EXE"
        } else {
            "mosquitto (from PATH), ProgramFiles/Mosquitto, ProgramFiles(x86)/Mosquitto"
        };

        let attempted = attempted_programs.join(", ");

        format!(
            "Failed to start broker: {error}. Last attempted executable: {attempted_program}. Tried: [{attempted}]. Check executable ({executable_hint}) and config ({}).",
            conf_path.display()
        )
    }
}

#[tauri::command]
pub fn start_broker_service(
    state: State<'_, BrokerServiceState>,
) -> Result<BrokerServiceStatus, String> {
    state.start()
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
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Failed to lock broker state".to_string())?;

    Ok(BrokerServiceState::snapshot_status(&mut child_slot))
}