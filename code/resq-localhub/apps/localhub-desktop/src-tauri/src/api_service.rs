use std::{
    collections::HashMap,
    env, fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Manager, State};
use crate::commands;

#[derive(Default)]
pub struct ApiServiceState {
    child: Mutex<Option<Child>>,
    status: Mutex<ApiServiceStatus>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub state: String,
    pub message: String,
    pub details: String,
    pub log_path: Option<String>,
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const BACKEND_RELATIVE_PATH: &str = "../../../services/hub-api";
const CLOUD_SYNC_CONFIG_DIR: &str = ".resq-localhub";
const CLOUD_SYNC_CONFIG_FILE: &str = "cloud-sync.env";
const CLOUD_SYNC_ENV_KEYS: [&str; 9] = [
    "RESQ_CLOUD_SYNC_ENABLED",
    "RESQ_CLOUD_SYNC_BASE_URL",
    "RESQ_CLOUD_SYNC_FIXED_DELAY_MS",
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

    fn backend_port() -> u16 {
        env::var("HUB_API_PORT")
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .unwrap_or(18080)
    }

    fn backend_health_url(port: u16) -> String {
        format!("http://127.0.0.1:{port}/api/hub/health")
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

        let default_envs = [
            ("RESQ_CLOUD_SYNC_ENABLED", "true"),
            ("RESQ_ROSTER_SYNC_ENABLED", "true"),
            ("RESQ_CLOUD_SYNC_BASE_URL", "https://0p72nthzej.execute-api.ap-southeast-1.amazonaws.com"),
            ("RESQ_ROSTER_SYNC_BASE_URL", "https://0p72nthzej.execute-api.ap-southeast-1.amazonaws.com"),
            ("RESQ_ROSTER_SYNC_HUB_ID", "hub-dev-01"),
            ("RESQ_ROSTER_SYNC_HUB_KEY", "dev-localhub-key-2026"),
            ("RESQ_CLOUD_SYNC_FIXED_DELAY_MS", "60000"),
            ("RESQ_ROSTER_SYNC_FIXED_DELAY_MS", "60000"),
        ];

        for &(key, val) in &default_envs {
            if env::var_os(key).is_none() {
                if let Some(config_val) = config.get(key) {
                    command.env(key, config_val);
                } else {
                    command.env(key, val);
                }
            }
        }

        for key in CLOUD_SYNC_ENV_KEYS {
            if env::var_os(key).is_none() {
                if let Some(value) = config.get(key) {
                    let is_default_key = default_envs.iter().any(|&(k, _)| k == key);
                    if !is_default_key {
                        command.env(key, value);
                    }
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

    fn set_status(&self, status: ApiServiceStatus) {
        if let Ok(mut current) = self.status.lock() {
            *current = status;
        }
    }

    fn get_status(&self) -> ApiServiceStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_default()
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
                state: "starting".to_string(),
                message: "Backend process is running.".to_string(),
                details: "The backend process is active but health has not been confirmed yet.".to_string(),
                log_path: None,
            },
            None => ApiServiceStatus {
                running: false,
                pid: None,
                state: "stopped".to_string(),
                message: "Backend is stopped.".to_string(),
                details: "No backend process is currently active.".to_string(),
                log_path: None,
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

    fn clean_windows_path(path: &Path) -> PathBuf {
        let path_str = path.to_string_lossy();
        if path_str.starts_with(r"\\?\") {
            PathBuf::from(&path_str[4..])
        } else {
            path.to_path_buf()
        }
    }

    fn packaged_java_path(resource_dir: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            resource_dir.join("jre").join("bin").join("java.exe")
        }

        #[cfg(not(target_os = "windows"))]
        {
            resource_dir.join("jre").join("bin").join("java")
        }
    }

    fn validate_packaged_resources(resource_dir: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
        let jar_path = resource_dir.join("hub-api").join("resq-hub-api.jar");
        let config_path = resource_dir
            .join("config")
            .join("application-release.properties");
        let java_path = Self::packaged_java_path(resource_dir);

        let missing = [
            ("backend JAR", jar_path.is_file(), jar_path.clone()),
            ("release config", config_path.is_file(), config_path.clone()),
            ("bundled Java runtime", java_path.is_file(), java_path.clone()),
        ]
        .into_iter()
        .filter_map(|(label, present, path)| (!present).then(|| format!("{label}: {}", path.display())))
        .collect::<Vec<_>>();

        if !missing.is_empty() {
            return Err(format!(
                "Missing packaged backend resources: {}",
                missing.join("; ")
            ));
        }

        Ok((jar_path, config_path, java_path))
    }

    fn backend_log_file(app: &tauri::AppHandle) -> Result<(fs::File, PathBuf), String> {
        let log_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("logs");
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("Failed to create backend log directory at {}: {error}", log_dir.display()))?;

        let log_path = log_dir.join("hub-api.log");
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| format!("Failed to open backend log file at {}: {error}", log_path.display()))?;

        Ok((file, log_path))
    }

    fn check_port_available(port: u16, service_name: &str) -> Result<(), String> {
        let socket_addr = format!("127.0.0.1:{port}")
            .to_socket_addrs()
            .map_err(|error| format!("Failed to resolve localhost for port check: {error}"))?
            .next()
            .ok_or_else(|| format!("Failed to resolve localhost for port {port}"))?;

        if TcpStream::connect_timeout(&socket_addr, Duration::from_millis(400)).is_ok() {
            return Err(format!(
                "Port {port} is already in use. {service_name} needs this port. Close the conflicting process or change the configured port."
            ));
        }

        Ok(())
    }

    fn wait_for_health_ready(child_slot: &mut Option<Child>, port: u16) -> Result<(), String> {
        let health_url = Self::backend_health_url(port);
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut delay = Duration::from_millis(400);

        loop {
            if let Some(child) = child_slot.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Backend process exited before it became healthy (exit status: {status})"
                    ));
                }
            }

            match ureq::get(&health_url).timeout(Duration::from_secs(2)).call() {
                Ok(response) if response.status() < 500 => return Ok(()),
                Ok(response) => {
                    let status = response.status();
                    if Instant::now() >= deadline {
                        return Err(format!(
                            "Backend health check did not become ready. Last HTTP status: {status}."
                        ));
                    }
                }
                Err(error) => {
                    if Instant::now() >= deadline {
                        return Err(format!(
                            "Timed out waiting for backend health at {health_url}: {error}"
                        ));
                    }
                }
            }

            if Instant::now() >= deadline {
                return Err(format!("Timed out waiting for backend health at {health_url}"));
            }

            thread::sleep(delay);
            delay = (delay + Duration::from_millis(200)).min(Duration::from_secs(2));
        }
    }

    fn build_packaged_command(app: &tauri::AppHandle) -> Result<Command, String> {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Failed to resolve packaged resource directory: {error}"))?;

        let (jar_path, config_path, java_path) = Self::validate_packaged_resources(&resource_dir)?;
        let clean_jar = Self::clean_windows_path(&jar_path);
        let clean_config = Self::clean_windows_path(&config_path);
        let clean_java = Self::clean_windows_path(&java_path);
        let (log_file, log_path) = Self::backend_log_file(app)?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|error| format!("Failed to clone backend log file handle: {error}"))?;

        let mut command = Command::new(clean_java);
        command
            .arg("-jar")
            .arg(&clean_jar)
            .arg(format!("--spring.config.location={}", clean_config.display()))
            .current_dir(&resource_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        eprintln!("Backend log path: {}", log_path.display());
        Ok(command)
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

        let is_debug = cfg!(debug_assertions);
        let backend_port = Self::backend_port();
        let mut command = if is_debug {
            let backend_dir = Self::backend_dir()?;
            eprintln!("Backend dev project directory: {}", backend_dir.display());
            let mut cmd = Self::build_dev_command(&backend_dir);
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());
            cmd
        } else {
            Self::check_port_available(backend_port, "The backend API")?;
            Self::build_packaged_command(app)?
        };

        if is_debug {
            eprintln!("Mode selected: Development (Dev)");
        } else {
            eprintln!("Mode selected: Packaged (Release)");
        }

        command.env("HUB_API_PORT", backend_port.to_string());
        Self::apply_cloud_sync_environment(&mut command);
        Self::hide_window(&mut command);

        eprintln!(
            "Backend working directory: {}",
            command
                .get_current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "default".to_string())
        );
        eprintln!(
            "Backend command path: {}",
            command.get_program().to_string_lossy()
        );
        eprintln!("Backend command configuration: {:?}", command);

        let mut status = ApiServiceStatus {
            running: true,
            pid: None,
            state: "starting".to_string(),
            message: "Backend is starting.".to_string(),
            details: format!("Waiting for the backend health endpoint on port {backend_port} to respond."),
            log_path: None,
        };

        if !is_debug {
            let log_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
                .join("logs");
            let log_path = log_dir.join("hub-api.log");
            status.log_path = Some(log_path.display().to_string());
        }

        self.set_status(status.clone());

        let child = command
            .spawn()
            .map_err(|error| {
                let failed_status = ApiServiceStatus {
                    running: false,
                    pid: None,
                    state: "failed".to_string(),
                    message: "Failed to start the backend process.".to_string(),
                    details: format!("Failed to start backend: {error}"),
                    log_path: status.log_path.clone(),
                };
                self.set_status(failed_status.clone());
                format!("Failed to start backend: {error}")
            })?;

        let pid = child.id();
        eprintln!("Backend process spawned successfully with PID: {}", pid);
        *child_slot = Some(child);

        let mut current_status = ApiServiceStatus {
            running: true,
            pid: Some(pid),
            state: "starting".to_string(),
            message: "Backend process started; waiting for health endpoint.".to_string(),
            details: format!("Waiting for backend health at {}", Self::backend_health_url(backend_port)),
            log_path: status.log_path.clone(),
        };
        self.set_status(current_status.clone());

        match Self::wait_for_health_ready(&mut child_slot, backend_port) {
            Ok(()) => {
                current_status.state = "ready".to_string();
                current_status.message = "Backend is ready.".to_string();
                current_status.details = format!("Health endpoint responded on port {backend_port}.");
                self.set_status(current_status.clone());
                Ok(current_status)
            }
            Err(error) => {
                let failed_status = ApiServiceStatus {
                    running: false,
                    pid: None,
                    state: "failed".to_string(),
                    message: "Backend failed to become ready.".to_string(),
                    details: error,
                    log_path: status.log_path.clone(),
                };
                *child_slot = None;
                self.set_status(failed_status.clone());
                Err(format!("{}", failed_status.details))
            }
        }
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

        let stopped = ApiServiceStatus {
            running: false,
            pid: None,
            state: "stopped".to_string(),
            message: "Backend is stopped.".to_string(),
            details: "The backend process was stopped.".to_string(),
            log_path: None,
        };
        self.set_status(stopped.clone());
        Ok(stopped)
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

    let mut current = ApiServiceState::snapshot_status(&mut child_slot);
    let cached = state.get_status();

    if !cached.running && current.running {
        current = cached;
    } else if cached.state != "stopped" && cached.state != "failed" {
        current = cached;
    }

    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, net::TcpListener, time::SystemTime};

    #[test]
    fn port_check_reports_conflict_when_port_is_busy() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();

        let result = ApiServiceState::check_port_available(port, "Test service");
        assert!(result.is_err());
    }

    #[test]
    fn packaged_resource_validation_reports_missing_paths() {
        let temp_dir = std::env::temp_dir().join(format!(
            "resq-api-resource-check-{}",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).expect("create temp dir");

        let result = ApiServiceState::validate_packaged_resources(&temp_dir);
        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("Missing packaged backend resources"));

        fs::remove_dir_all(temp_dir).ok();
    }
}
