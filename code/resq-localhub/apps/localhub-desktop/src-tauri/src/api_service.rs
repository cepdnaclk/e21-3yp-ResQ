use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::Serialize;
use tauri::{Manager, State};

#[derive(Default)]
pub struct ApiServiceState {
    child: Mutex<Option<Child>>,
}

#[derive(Serialize, Clone)]
pub struct ApiServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const BACKEND_RELATIVE_PATH: &str = "../../../services/hub-api";
const CLOUD_SYNC_CONFIG_DIR: &str = ".resq-localhub";
const CLOUD_SYNC_CONFIG_FILE: &str = "cloud-sync.env";
const CLOUD_SYNC_ENV_KEYS: [&str; 6] = [
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

    fn user_home_dir() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .or_else(|| env::var_os("HOME").map(PathBuf::from))
        }

        #[cfg(not(target_os = "windows"))]
        {
            env::var_os("HOME").map(PathBuf::from)
        }
    }

    fn load_cloud_sync_config() -> HashMap<String, String> {
        let Some(home_dir) = Self::user_home_dir() else {
            eprintln!("LocalHub cloud sync config was not loaded: user home directory not found");
            return HashMap::new();
        };

        let config_path = home_dir
            .join(CLOUD_SYNC_CONFIG_DIR)
            .join(CLOUD_SYNC_CONFIG_FILE);
        let contents = match fs::read_to_string(&config_path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return HashMap::new(),
            Err(error) => {
                eprintln!(
                    "LocalHub cloud sync config could not be read from {}: {error}",
                    config_path.display()
                );
                return HashMap::new();
            }
        };

        let mut config = HashMap::new();
        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            if CLOUD_SYNC_ENV_KEYS.contains(&key) {
                config.insert(key.to_string(), value.trim().to_string());
            }
        }

        eprintln!(
            "Loaded LocalHub cloud sync config from {}",
            config_path.display()
        );
        config
    }

    fn apply_cloud_sync_environment(command: &mut Command) {
        let config = Self::load_cloud_sync_config();

        for key in CLOUD_SYNC_ENV_KEYS {
            if env::var_os(key).is_none() {
                if let Some(value) = config.get(key) {
                    command.env(key, value);
                }
            }
        }

        let value_is_configured = |key: &str| match env::var_os(key) {
            Some(value) => !value.is_empty(),
            None => config.get(key).is_some_and(|value| !value.is_empty()),
        };
        let base_url_configured = value_is_configured("RESQ_ROSTER_SYNC_BASE_URL");
        let hub_id_configured = value_is_configured("RESQ_ROSTER_SYNC_HUB_ID");

        eprintln!(
            "LocalHub cloud sync configuration: base-url configured={base_url_configured}, hub-id configured={hub_id_configured}"
        );
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

    fn build_dev_command(backend_dir: &Path) -> Command {
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

    fn build_packaged_command(app: &tauri::AppHandle) -> Result<Option<Command>, String> {
        let resource_dir = match app.path().resource_dir() {
            Ok(path) => path,
            Err(_) => return Ok(None),
        };

        let jar_path = resource_dir.join("hub-api").join("resq-hub-api.jar");
        let config_path = resource_dir
            .join("config")
            .join("application-release.properties");

        if jar_path.is_file() && config_path.is_file() {
            let mut command = Command::new("java");
            command
                .arg("-jar")
                .arg(&jar_path)
                .arg(format!(
                    "--spring.config.location={}",
                    config_path.display()
                ))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            return Ok(Some(command));
        }

        if jar_path.exists() || config_path.exists() {
            return Err(format!(
                "Incomplete packaged backend resources. Expected JAR at {} and config at {}",
                jar_path.display(),
                config_path.display()
            ));
        }

        Ok(None)
    }

    fn hide_window(command: &mut Command) {
        #[cfg(target_os = "windows")]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
    }

    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<ApiServiceStatus, String> {
        let mut child_slot = self
            .child
            .lock()
            .map_err(|_| "Failed to lock backend state".to_string())?;

        let current_status = Self::snapshot_status(&mut child_slot);
        if current_status.running {
            return Ok(current_status);
        }

        let mut command = match Self::build_packaged_command(app)? {
            Some(command) => command,
            None => {
                let backend_dir = Self::backend_dir()?;
                Self::build_dev_command(&backend_dir)
            }
        };

        Self::apply_cloud_sync_environment(&mut command);
        Self::hide_window(&mut command);

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
) -> Result<ApiServiceStatus, String> {
    state.start_with_app(&app)
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
