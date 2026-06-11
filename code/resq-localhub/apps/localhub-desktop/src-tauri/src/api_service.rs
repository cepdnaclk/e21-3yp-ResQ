use serde::Serialize;
use std::{
    collections::HashMap,
    env, fs,
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::State;

#[derive(Default)]
pub struct ApiServiceState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize, Clone)]
pub struct ApiServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

const BACKEND_RELATIVE_PATH: &str = "../../../services/hub-api";
const CLOUD_SYNC_CONFIG_DIRECTORY: &str = ".resq-localhub";
const CLOUD_SYNC_CONFIG_FILE: &str = "cloud-sync.env";
const ROSTER_SYNC_ENV_KEYS: [&str; 6] = [
    "RESQ_ROSTER_SYNC_ENABLED",
    "RESQ_ROSTER_SYNC_BASE_URL",
    "RESQ_ROSTER_SYNC_HUB_ID",
    "RESQ_ROSTER_SYNC_HUB_KEY",
    "RESQ_ROSTER_SYNC_FIXED_DELAY_MS",
    "RESQ_ROSTER_SYNC_TIMEOUT_MS",
];

impl ApiServiceState {
    fn backend_dir() -> Result<PathBuf, String> {
        let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BACKEND_RELATIVE_PATH);

        if !backend_dir.exists() {
            return Err(format!("Backend project not found at {}", backend_dir.display()));
        }

        Ok(backend_dir)
    }

    fn snapshot_status(child_slot: &mut Option<Child>) -> ApiServiceStatus {
        if let Some(child) = child_slot.as_mut() {
            if matches!(child.try_wait(), Ok(Some(_))) {
                *child_slot = None;
            }
        }

        match child_slot.as_ref() {
            Some(child) => ApiServiceStatus {
                running: true,
                pid: Some(child.id()),
            },
            None => ApiServiceStatus {
                running: false,
                pid: None,
            },
        }
    }

    fn cloud_sync_config_path() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let home_dir = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));

        #[cfg(not(target_os = "windows"))]
        let home_dir = env::var_os("HOME");

        home_dir.map(|home| {
            PathBuf::from(home)
                .join(CLOUD_SYNC_CONFIG_DIRECTORY)
                .join(CLOUD_SYNC_CONFIG_FILE)
        })
    }

    fn parse_cloud_sync_config(contents: &str) -> HashMap<String, String> {
        contents
            .lines()
            .filter_map(|line| {
                let line = line.trim().trim_start_matches('\u{feff}');
                if line.is_empty() || line.starts_with('#') {
                    return None;
                }

                let (key, value) = line.split_once('=')?;
                let key = key.trim();
                if !ROSTER_SYNC_ENV_KEYS.contains(&key) {
                    return None;
                }

                Some((key.to_string(), value.trim().to_string()))
            })
            .collect()
    }

    fn roster_sync_environment() -> HashMap<String, OsString> {
        let mut values = ROSTER_SYNC_ENV_KEYS
            .iter()
            .filter_map(|key| env::var_os(key).map(|value| ((*key).to_string(), value)))
            .collect::<HashMap<_, _>>();

        if let Some(config_path) = Self::cloud_sync_config_path() {
            match fs::read_to_string(&config_path) {
                Ok(contents) => {
                    for (key, value) in Self::parse_cloud_sync_config(&contents) {
                        values.entry(key).or_insert_with(|| OsString::from(value));
                    }
                    println!(
                        "Loaded LocalHub cloud sync configuration from {}",
                        config_path.display()
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => eprintln!(
                    "Unable to read LocalHub cloud sync configuration from {}: {}",
                    config_path.display(),
                    error
                ),
            }
        }

        println!(
            "Roster sync configuration: base-url={}, hub-id={}",
            values.contains_key("RESQ_ROSTER_SYNC_BASE_URL"),
            values.contains_key("RESQ_ROSTER_SYNC_HUB_ID")
        );

        values
    }

    fn build_command(backend_dir: &Path) -> Command {
        #[cfg(target_os = "windows")]
        {
            let wrapper = backend_dir.join("mvnw.cmd");

            if wrapper.exists() {
                let mut command = Command::new("cmd");
                command.args(["/C", "mvnw.cmd", "spring-boot:run"]);
                command.current_dir(backend_dir);
                command.stdin(Stdio::null());
                return command;
            }

            let mut command = Command::new("mvn");
            command.arg("spring-boot:run");
            command.current_dir(backend_dir);
            command.stdin(Stdio::null());
            return command;
        }

        #[cfg(not(target_os = "windows"))]
        {
            let wrapper = backend_dir.join("mvnw");

            if wrapper.exists() {
                let mut command = Command::new("./mvnw");
                command.arg("spring-boot:run");
                command.current_dir(backend_dir);
                command.stdin(Stdio::null());
                return command;
            }

            let mut command = Command::new("mvn");
            command.arg("spring-boot:run");
            command.current_dir(backend_dir);
            command.stdin(Stdio::null());
            command
        }
    }

    pub fn start(&self) -> Result<ApiServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        let current_status = Self::snapshot_status(&mut child_slot);
        if current_status.running {
            return Ok(current_status);
        }

        let backend_dir = Self::backend_dir()?;
        let mut command = Self::build_command(&backend_dir);
        command.envs(Self::roster_sync_environment());
        let child = command
            .spawn()
            .map_err(|error| format!("Failed to start backend: {error}"))?;

        let pid = child.id();
        *child_slot = Some(child);

        Ok(ApiServiceStatus {
            running: true,
            pid: Some(pid),
        })
    }

    pub fn stop(&self) -> Result<ApiServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        Self::snapshot_status(&mut child_slot);

        if let Some(mut child) = child_slot.take() {
            Self::terminate_child(&mut child)?;
        }

        Ok(ApiServiceStatus {
            running: false,
            pid: None,
        })
    }

    fn terminate_child(child: &mut Child) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let pid = child.id().to_string();
            let taskkill_status = Command::new("taskkill")
                .args(["/PID", &pid, "/T", "/F"])
                .status();

            if let Ok(status) = taskkill_status {
                if !status.success() {
                    let _ = child.kill();
                }
            } else {
                let _ = child.kill();
            }

            let _ = child.wait();
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            child
                .kill()
                .map_err(|error| format!("Failed to stop backend: {error}"))?;
            let _ = child.wait();
            Ok(())
        }
    }
}

#[tauri::command]
pub fn start_api_service(state: State<'_, ApiServiceState>) -> Result<ApiServiceStatus, String> {
    state.start()
}

#[tauri::command]
pub fn stop_api_service(state: State<'_, ApiServiceState>) -> Result<ApiServiceStatus, String> {
    state.stop()
}

#[tauri::command]
pub fn get_api_service_status(
    state: State<'_, ApiServiceState>,
) -> Result<ApiServiceStatus, String> {
    let mut child_slot = state
        .child
        .lock()
        .map_err(|_| "Failed to lock backend state".to_string())?;

    Ok(ApiServiceState::snapshot_status(&mut child_slot))
}
