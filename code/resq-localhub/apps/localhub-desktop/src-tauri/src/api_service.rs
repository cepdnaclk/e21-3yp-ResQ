use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use crate::process_lifecycle::{
    assign_child_to_job, ensure_port_available_or_recover_stale, hide_window, persist_metadata,
    runtime_pid_file, terminate_managed_process, ManagedProcess,
};
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Default)]
pub struct ApiServiceState {
    child: Mutex<Option<ManagedProcess>>,
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

struct JavaExecutable {
    command_path: PathBuf,
    version_probe_path: Option<PathBuf>,
    source: String,
}

impl ApiServiceState {
    fn backend_dir() -> Result<PathBuf, String> {
        let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BACKEND_RELATIVE_PATH);

        if !backend_dir.exists() {
            return Err(format!(
                "Backend project not found at {}",
                backend_dir.display()
            ));
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
            (
                "RESQ_CLOUD_SYNC_BASE_URL",
                "https://0p72nthzej.execute-api.ap-southeast-1.amazonaws.com",
            ),
            (
                "RESQ_ROSTER_SYNC_BASE_URL",
                "https://0p72nthzej.execute-api.ap-southeast-1.amazonaws.com",
            ),
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

    fn snapshot_status(child_slot: &mut Option<ManagedProcess>) -> ApiServiceStatus {
        if let Some(process) = child_slot.as_mut() {
            let Some(child) = process.child.as_mut() else {
                *child_slot = None;
                return ApiServiceStatus {
                    running: false,
                    pid: None,
                    state: "stopped".to_string(),
                    message: "Backend is stopped.".to_string(),
                    details: "No backend process is currently active.".to_string(),
                    log_path: None,
                };
            };
            if matches!(child.try_wait(), Ok(Some(_))) {
                *child_slot = None;
            }
        }

        match child_slot.as_ref() {
            Some(process) => ApiServiceStatus {
                running: true,
                pid: process.pid,
                state: "starting".to_string(),
                message: "Backend process is running.".to_string(),
                details: "The backend process is active but health has not been confirmed yet."
                    .to_string(),
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

    fn build_dev_command(backend_dir: &Path) -> (Command, PathBuf, Vec<String>) {
        #[cfg(target_os = "windows")]
        {
            let wrapper = backend_dir.join("mvnw.cmd");

            if wrapper.exists() {
                let mut command = Command::new("cmd");
                command.args(["/C", "mvnw.cmd", "spring-boot:run"]);
                command.current_dir(backend_dir);
                command.stdin(Stdio::null());
                return (
                    command,
                    PathBuf::from("cmd.exe"),
                    vec!["mvnw.cmd".to_string(), "spring-boot:run".to_string()],
                );
            }

            let mut command = Command::new("mvn");
            command.arg("spring-boot:run");
            command.current_dir(backend_dir);
            command.stdin(Stdio::null());
            return (
                command,
                PathBuf::from("mvn"),
                vec!["spring-boot:run".to_string()],
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            let wrapper = backend_dir.join("mvnw");

            if wrapper.exists() {
                let mut command = Command::new("./mvnw");
                command.arg("spring-boot:run");
                command.current_dir(backend_dir);
                command.stdin(Stdio::null());
                return (command, wrapper, vec!["spring-boot:run".to_string()]);
            }

            let mut command = Command::new("mvn");
            command.arg("spring-boot:run");
            command.current_dir(backend_dir);
            command.stdin(Stdio::null());
            (
                command,
                PathBuf::from("mvn"),
                vec!["spring-boot:run".to_string()],
            )
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

    fn bundled_java_path(resource_dir: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            resource_dir.join("jre").join("bin").join("javaw.exe")
        }

        #[cfg(not(target_os = "windows"))]
        {
            resource_dir.join("jre").join("bin").join("java")
        }
    }

    fn java_version_probe_path(java_home: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            java_home.join("bin").join("java.exe")
        }

        #[cfg(not(target_os = "windows"))]
        {
            java_home.join("bin").join("java")
        }
    }

    fn javaw_path(java_home: &Path) -> PathBuf {
        #[cfg(target_os = "windows")]
        {
            java_home.join("bin").join("javaw.exe")
        }

        #[cfg(not(target_os = "windows"))]
        {
            java_home.join("bin").join("java")
        }
    }

    fn java_from_home(java_home: &Path, source: &str) -> Option<JavaExecutable> {
        let javaw_path = Self::javaw_path(java_home);
        let java_path = Self::java_version_probe_path(java_home);

        let command_path = if javaw_path.is_file() {
            javaw_path
        } else if java_path.is_file() {
            java_path.clone()
        } else {
            return None;
        };

        Some(JavaExecutable {
            command_path,
            version_probe_path: java_path.is_file().then_some(java_path),
            source: source.to_string(),
        })
    }

    fn path_lookup(executable_name: &str) -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        let lookup_command = "where.exe";

        #[cfg(not(target_os = "windows"))]
        let lookup_command = "which";

        let output = Command::new(lookup_command)
            .arg(executable_name)
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(PathBuf::from)
            .find(|path| path.is_file())
    }

    fn java_from_path() -> Option<JavaExecutable> {
        #[cfg(target_os = "windows")]
        {
            let javaw_path = Self::path_lookup("javaw.exe");
            let java_path = Self::path_lookup("java.exe").or_else(|| Self::path_lookup("java"));
            let command_path = javaw_path.or_else(|| java_path.clone())?;

            Some(JavaExecutable {
                command_path,
                version_probe_path: java_path,
                source: "Java from PATH".to_string(),
            })
        }

        #[cfg(not(target_os = "windows"))]
        {
            let java_path = Self::path_lookup("java")?;

            Some(JavaExecutable {
                command_path: java_path.clone(),
                version_probe_path: Some(java_path),
                source: "Java from PATH".to_string(),
            })
        }
    }

    fn parse_java_major_version(version_output: &str) -> Option<u32> {
        let version = version_output.split('"').nth(1).or_else(|| {
            version_output
                .split_whitespace()
                .find(|part| part.chars().next().is_some_and(|ch| ch.is_ascii_digit()))
        })?;

        let mut parts = version.split('.');
        let first = parts.next()?.parse::<u32>().ok()?;
        if first == 1 {
            parts.next()?.parse::<u32>().ok()
        } else {
            Some(first)
        }
    }

    fn validate_java_17(candidate: JavaExecutable) -> Result<JavaExecutable, String> {
        let Some(probe_path) = candidate.version_probe_path.as_ref() else {
            eprintln!(
                "Java version check skipped for {} because java.exe was not found next to {}",
                candidate.source,
                candidate.command_path.display()
            );
            return Ok(candidate);
        };

        let output = Command::new(probe_path)
            .arg("-version")
            .output()
            .map_err(|error| {
                format!(
                    "{} resolved to {}, but its Java version could not be checked: {error}",
                    candidate.source,
                    probe_path.display()
                )
            })?;

        let version_output = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let major = Self::parse_java_major_version(&version_output).ok_or_else(|| {
            format!(
                "{} resolved to {}, but its Java version output could not be parsed.",
                candidate.source,
                probe_path.display()
            )
        })?;

        if major != 17 {
            return Err(format!(
                "{} resolved to {}, but it reports Java {major}. ResQ Local Hub requires Java 17.",
                candidate.source,
                probe_path.display()
            ));
        }

        Ok(candidate)
    }

    fn resolve_java_for_packaged_backend(resource_dir: &Path) -> Result<JavaExecutable, String> {
        let bundled_java = Self::bundled_java_path(resource_dir);
        let bundled_probe = Self::java_version_probe_path(&resource_dir.join("jre"));
        let mut checked = Vec::new();

        let bundled_candidate = bundled_java.is_file().then(|| JavaExecutable {
            command_path: bundled_java.clone(),
            version_probe_path: bundled_probe.is_file().then_some(bundled_probe),
            source: "bundled Java runtime".to_string(),
        });

        let java_home = env::var_os("JAVA_HOME").filter(|value| !value.is_empty());
        let java_home_candidate = java_home
            .as_ref()
            .and_then(|value| Self::java_from_home(&PathBuf::from(value), "JAVA_HOME"));
        let java_home_invalid = java_home.is_some() && java_home_candidate.is_none();

        let candidates = [
            bundled_candidate,
            java_home_candidate,
            Self::java_from_path(),
        ];

        for candidate in candidates.into_iter().flatten() {
            match Self::validate_java_17(candidate) {
                Ok(valid) => return Ok(valid),
                Err(error) => checked.push(error),
            }
        }

        if !bundled_java.is_file() {
            checked.push(format!(
                "bundled Java runtime was not found at {}",
                bundled_java.display()
            ));
        }
        if let Some(value) = java_home {
            if java_home_invalid {
                checked.push(format!(
                    "JAVA_HOME is set to {}, but bin/javaw.exe or bin/java was not found",
                    PathBuf::from(value).display()
                ));
            }
        } else {
            checked.push("JAVA_HOME is not set".to_string());
        }
        if Self::java_from_path().is_none() {
            checked.push("javaw.exe/java was not found on PATH".to_string());
        }

        Err(format!(
            "Java 17 is required to start the ResQ Local Hub backend. For development, install Java 17 and set JAVA_HOME or add Java to PATH. For packaged releases, the bundled runtime is missing or invalid; run `pnpm tauri:build` to stage and bundle `src-tauri/resources/jre`. Checked: {}",
            checked.join("; ")
        ))
    }

    fn resolve_java_for_development() -> Result<JavaExecutable, String> {
        let java_home = env::var_os("JAVA_HOME").filter(|value| !value.is_empty());
        let java_home_candidate = java_home
            .as_ref()
            .and_then(|value| Self::java_from_home(&PathBuf::from(value), "JAVA_HOME"));
        let java_home_invalid = java_home.is_some() && java_home_candidate.is_none();

        let candidates = [java_home_candidate, Self::java_from_path()];
        let mut checked = Vec::new();

        for candidate in candidates.into_iter().flatten() {
            match Self::validate_java_17(candidate) {
                Ok(valid) => return Ok(valid),
                Err(error) => checked.push(error),
            }
        }

        if let Some(value) = java_home {
            if java_home_invalid {
                checked.push(format!(
                    "JAVA_HOME is set to {}, but bin/javaw.exe or bin/java was not found",
                    PathBuf::from(value).display()
                ));
            }
        } else {
            checked.push("JAVA_HOME is not set".to_string());
        }
        if Self::java_from_path().is_none() {
            checked.push("javaw.exe/java was not found on PATH".to_string());
        }

        Err(format!(
            "Java 17 is required for development. Install Java 17 and set JAVA_HOME or add Java to PATH before running `pnpm tauri dev`. Checked: {}",
            checked.join("; ")
        ))
    }

    fn validate_packaged_resources(resource_dir: &Path) -> Result<(PathBuf, PathBuf), String> {
        let jar_path = resource_dir.join("hub-api").join("resq-hub-api.jar");
        let config_path = resource_dir
            .join("config")
            .join("application-release.properties");

        let missing = [
            ("backend JAR", jar_path.is_file(), jar_path.clone()),
            ("release config", config_path.is_file(), config_path.clone()),
        ]
        .into_iter()
        .filter_map(|(label, present, path)| {
            (!present).then(|| format!("{label}: {}", path.display()))
        })
        .collect::<Vec<_>>();

        if !missing.is_empty() {
            return Err(format!(
                "Missing packaged backend resources: {}",
                missing.join("; ")
            ));
        }

        Ok((jar_path, config_path))
    }

    fn backend_log_file(app: &tauri::AppHandle) -> Result<(fs::File, PathBuf), String> {
        let log_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
            .join("logs");
        fs::create_dir_all(&log_dir).map_err(|error| {
            format!(
                "Failed to create backend log directory at {}: {error}",
                log_dir.display()
            )
        })?;

        let log_path = log_dir.join("hub-api.log");
        let file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|error| {
                format!(
                    "Failed to open backend log file at {}: {error}",
                    log_path.display()
                )
            })?;

        Ok((file, log_path))
    }

    fn wait_for_health_ready(
        child_slot: &mut Option<ManagedProcess>,
        port: u16,
    ) -> Result<(), String> {
        let health_url = Self::backend_health_url(port);
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut delay = Duration::from_millis(400);

        loop {
            if let Some(process) = child_slot.as_mut() {
                let Some(child) = process.child.as_mut() else {
                    return Err(
                        "Backend process handle was missing while waiting for health.".to_string(),
                    );
                };
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!(
                        "Backend process exited before it became healthy (exit status: {status})"
                    ));
                }
            }

            match ureq::get(&health_url)
                .timeout(Duration::from_secs(2))
                .call()
            {
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
                return Err(format!(
                    "Timed out waiting for backend health at {health_url}"
                ));
            }

            thread::sleep(delay);
            delay = (delay + Duration::from_millis(200)).min(Duration::from_secs(2));
        }
    }

    fn build_packaged_command(
        app: &tauri::AppHandle,
    ) -> Result<(Command, PathBuf, Vec<String>), String> {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("Failed to resolve packaged resource directory: {error}"))?;

        let (jar_path, config_path) = Self::validate_packaged_resources(&resource_dir)?;
        let java = Self::resolve_java_for_packaged_backend(&resource_dir)?;
        let clean_jar = Self::clean_windows_path(&jar_path);
        let clean_config = Self::clean_windows_path(&config_path);
        let clean_java = Self::clean_windows_path(&java.command_path);
        let (log_file, log_path) = Self::backend_log_file(app)?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|error| format!("Failed to clone backend log file handle: {error}"))?;

        let mut command = Command::new(&clean_java);
        command
            .arg("-jar")
            .arg(&clean_jar)
            .arg(format!(
                "--spring.config.location={}",
                clean_config.display()
            ))
            .current_dir(&resource_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        eprintln!("Backend log path: {}", log_path.display());
        eprintln!(
            "Backend Java runtime: {} ({})",
            clean_java.display(),
            java.source
        );
        Ok((
            command,
            clean_java,
            vec![
                "-jar".to_string(),
                clean_jar.display().to_string(),
                format!("--spring.config.location={}", clean_config.display()),
            ],
        ))
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
        let backend_pid_file = runtime_pid_file(app, "backend")?;
        ensure_port_available_or_recover_stale(backend_port, "The backend API", &backend_pid_file)?;

        let (mut command, executable_path, command_line) = if is_debug {
            let java = Self::resolve_java_for_development()?;
            let backend_dir = Self::backend_dir()?;
            eprintln!("Backend dev project directory: {}", backend_dir.display());
            let (mut cmd, exe, args) = Self::build_dev_command(&backend_dir);
            if java.source == "Java from PATH" {
                cmd.env_remove("JAVA_HOME");
            }
            eprintln!(
                "Backend development Java runtime: {} ({})",
                java.command_path.display(),
                java.source
            );
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());
            (cmd, exe, args)
        } else {
            Self::build_packaged_command(app)?
        };

        if is_debug {
            eprintln!("Mode selected: Development (Dev)");
        } else {
            eprintln!("Mode selected: Packaged (Release)");
        }

        command.env("HUB_API_PORT", backend_port.to_string());
        command.env("RESQ_LOCALHUB_MANAGED_SERVICE", "backend");
        Self::apply_cloud_sync_environment(&mut command);
        hide_window(&mut command);

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
            details: format!(
                "Waiting for the backend health endpoint on port {backend_port} to respond."
            ),
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

        let child = command.spawn().map_err(|error| {
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
        eprintln!("Started service: backend pid={}", pid);
        let mut full_command_line = vec![command.get_program().to_string_lossy().to_string()];
        full_command_line.extend(command_line);
        let mut managed = ManagedProcess::from_child(
            "backend",
            child,
            executable_path,
            full_command_line,
            Some(backend_pid_file.clone()),
            vec![backend_port],
        );

        let child_ref = managed
            .child
            .as_ref()
            .ok_or_else(|| "Backend process handle was missing after spawn.".to_string())?;
        if let Err(error) = assign_child_to_job(child_ref, "backend") {
            let _ = terminate_managed_process(&mut managed);
            return Err(error);
        }
        if let Err(error) = persist_metadata(&managed) {
            let _ = terminate_managed_process(&mut managed);
            return Err(error);
        }
        *child_slot = Some(managed);

        let mut current_status = ApiServiceStatus {
            running: true,
            pid: Some(pid),
            state: "starting".to_string(),
            message: "Backend process started; waiting for health endpoint.".to_string(),
            details: format!(
                "Waiting for backend health at {}",
                Self::backend_health_url(backend_port)
            ),
            log_path: status.log_path.clone(),
        };
        self.set_status(current_status.clone());

        match Self::wait_for_health_ready(&mut child_slot, backend_port) {
            Ok(()) => {
                current_status.state = "ready".to_string();
                current_status.message = "Backend is ready.".to_string();
                current_status.details =
                    format!("Health endpoint responded on port {backend_port}.");
                self.set_status(current_status.clone());
                Ok(current_status)
            }
            Err(error) => {
                if let Some(mut process) = child_slot.take() {
                    let _ = terminate_managed_process(&mut process);
                }
                let failed_status = ApiServiceStatus {
                    running: false,
                    pid: None,
                    state: "failed".to_string(),
                    message: "Backend failed to become ready.".to_string(),
                    details: error,
                    log_path: status.log_path.clone(),
                };
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

        if let Some(mut process) = child_slot.take() {
            terminate_managed_process(&mut process)?;
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
    use std::{fs, time::SystemTime};

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

    #[test]
    fn java_major_version_parser_handles_modern_and_legacy_formats() {
        assert_eq!(
            ApiServiceState::parse_java_major_version(r#"openjdk version "17.0.12" 2024-07-16"#),
            Some(17)
        );
        assert_eq!(
            ApiServiceState::parse_java_major_version(r#"java version "1.8.0_402""#),
            Some(8)
        );
    }
}
