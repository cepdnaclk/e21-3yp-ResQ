use serde::Serialize;
#[cfg(any(not(debug_assertions), test))]
use std::path::{Component, Path, PathBuf};
#[cfg(not(debug_assertions))]
use std::{fs, time::Duration};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
};
#[cfg(not(debug_assertions))]
use tauri::Manager;
use tauri::State;
#[cfg(not(debug_assertions))]
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use crate::commands::detect_primary_ipv4;
#[cfg(debug_assertions)]
use crate::process_lifecycle::is_port_listening;

pub const STUDENT_DASHBOARD_PORT: u16 = 1420;
pub const BACKEND_PORT: u16 = 18080;
#[cfg(not(debug_assertions))]
const HEALTH_PATH: &str = "/localhub-web-health";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StudentDashboardStatus {
    pub running: bool,
    pub port: u16,
    pub lan_ip: Option<String>,
    pub url: Option<String>,
    pub backend_url: Option<String>,
    pub error: Option<String>,
}

impl Default for StudentDashboardStatus {
    fn default() -> Self {
        Self {
            running: false,
            port: STUDENT_DASHBOARD_PORT,
            lan_ip: None,
            url: None,
            backend_url: None,
            error: None,
        }
    }
}

struct LanWebServerRuntime {
    shutdown: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct LanWebServerState {
    status: Arc<Mutex<StudentDashboardStatus>>,
    runtime: Mutex<Option<LanWebServerRuntime>>,
}

impl LanWebServerState {
    fn set_status(&self, status: StudentDashboardStatus) {
        if let Ok(mut current) = self.status.lock() {
            *current = status;
        }
    }

    pub fn status(&self) -> StudentDashboardStatus {
        self.status
            .lock()
            .map(|status| status.clone())
            .unwrap_or_else(|_| StudentDashboardStatus {
                error: Some("Student dashboard state is unavailable.".to_string()),
                ..StudentDashboardStatus::default()
            })
    }

    fn status_for_network(
        running: bool,
        lan_ip: Option<String>,
        error: Option<String>,
    ) -> StudentDashboardStatus {
        let url = lan_ip
            .as_ref()
            .map(|ip| build_dashboard_url(ip, STUDENT_DASHBOARD_PORT));
        let backend_url = lan_ip
            .as_ref()
            .map(|ip| format!("http://{ip}:{BACKEND_PORT}"));

        StudentDashboardStatus {
            running,
            port: STUDENT_DASHBOARD_PORT,
            lan_ip,
            url,
            backend_url,
            error,
        }
    }

    #[cfg(debug_assertions)]
    pub fn observe_development_server(&self) -> StudentDashboardStatus {
        let running = is_port_listening(STUDENT_DASHBOARD_PORT);
        let lan_ip = detect_primary_ipv4().unwrap_or_default();
        let error = if !running {
            Some("The Vite development server is not listening on port 1420.".to_string())
        } else if lan_ip.is_none() {
            Some("No private LAN IPv4 address is currently available.".to_string())
        } else {
            None
        };
        let status = Self::status_for_network(running, lan_ip, error);
        self.set_status(status.clone());
        status
    }

    #[cfg(not(debug_assertions))]
    pub fn start_with_app(&self, app: &tauri::AppHandle) -> Result<StudentDashboardStatus, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Failed to lock student dashboard server state".to_string())?;
        if runtime.is_some() {
            return Ok(self.status());
        }

        let resource_dir = app.path().resource_dir().map_err(|error| {
            format!("Failed to resolve application resource directory: {error}")
        })?;
        let web_root = resource_dir.join("web-dashboard");
        validate_web_root(&web_root)?;

        let server = Server::http(("0.0.0.0", STUDENT_DASHBOARD_PORT)).map_err(|error| {
            let message = format!(
                "Student dashboard could not start because port {} is unavailable: {error}",
                STUDENT_DASHBOARD_PORT
            );
            let lan_ip = detect_primary_ipv4().unwrap_or_default();
            self.set_status(Self::status_for_network(
                false,
                lan_ip,
                Some(message.clone()),
            ));
            message
        })?;

        let lan_ip = detect_primary_ipv4()?;
        let network_error = lan_ip
            .is_none()
            .then(|| "No private LAN IPv4 address is currently available.".to_string());
        let starting_status = Self::status_for_network(true, lan_ip, network_error);
        self.set_status(starting_status.clone());

        let shutdown = Arc::new(AtomicBool::new(false));
        let thread_shutdown = Arc::clone(&shutdown);
        let thread_status = Arc::clone(&self.status);
        let thread = std::thread::Builder::new()
            .name("resq-lan-web-server".to_string())
            .spawn(move || run_server(server, web_root, thread_shutdown, thread_status))
            .map_err(|error| {
                let message = format!("Failed to start student dashboard server thread: {error}");
                let mut failed = starting_status.clone();
                failed.running = false;
                failed.error = Some(message.clone());
                self.set_status(failed);
                message
            })?;

        *runtime = Some(LanWebServerRuntime { shutdown, thread });
        Ok(starting_status)
    }

    pub fn refresh_address(&self) -> Result<StudentDashboardStatus, String> {
        let current = self.status();
        let lan_ip = detect_primary_ipv4()?;
        let error = if lan_ip.is_none() {
            Some("No private LAN IPv4 address is currently available.".to_string())
        } else if !current.running {
            current.error
        } else {
            None
        };
        let refreshed = Self::status_for_network(current.running, lan_ip, error);
        self.set_status(refreshed.clone());
        Ok(refreshed)
    }

    pub fn stop(&self) -> Result<StudentDashboardStatus, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Failed to lock student dashboard server state".to_string())?;
        if let Some(runtime) = runtime.take() {
            runtime.shutdown.store(true, Ordering::Release);
            runtime.thread.join().map_err(|_| {
                "Student dashboard server thread did not shut down cleanly.".to_string()
            })?;
        }

        let mut stopped = self.status();
        stopped.running = false;
        stopped.error = None;
        self.set_status(stopped.clone());
        Ok(stopped)
    }
}

#[cfg(not(debug_assertions))]
fn run_server(
    server: Server,
    web_root: PathBuf,
    shutdown: Arc<AtomicBool>,
    status: Arc<Mutex<StudentDashboardStatus>>,
) {
    while !shutdown.load(Ordering::Acquire) {
        match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => serve_request(request, &web_root),
            Ok(None) => {}
            Err(error) => {
                if let Ok(mut current) = status.lock() {
                    current.running = false;
                    current.error = Some(format!("Student dashboard server stopped: {error}"));
                }
                break;
            }
        }
    }
}

#[cfg(not(debug_assertions))]
fn serve_request(request: Request, web_root: &Path) {
    if request.url().split('?').next() == Some(HEALTH_PATH)
        && (request.method() == &Method::Get || request.method() == &Method::Head)
    {
        let body = format!(r#"{{"status":"UP","port":{STUDENT_DASHBOARD_PORT}}}"#);
        let response = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(content_type_header("application/json; charset=utf-8"))
            .with_header(cache_control_header("no-store"));
        let _ = request.respond(response);
        return;
    }

    if request.method() != &Method::Get && request.method() != &Method::Head {
        let response = Response::from_string("Method not allowed")
            .with_status_code(StatusCode(405))
            .with_header(content_type_header("text/plain; charset=utf-8"));
        let _ = request.respond(response);
        return;
    }

    let head_only = request.method() == &Method::Head;
    let relative_path = match safe_relative_path(request.url()) {
        Ok(path) => path,
        Err(message) => {
            let response = Response::from_string(message)
                .with_status_code(StatusCode(400))
                .with_header(content_type_header("text/plain; charset=utf-8"));
            let _ = request.respond(response);
            return;
        }
    };

    let requested = if relative_path.as_os_str().is_empty() {
        web_root.join("index.html")
    } else {
        web_root.join(&relative_path)
    };
    let selected = if requested.is_file() {
        requested
    } else if should_use_spa_fallback(&relative_path) {
        web_root.join("index.html")
    } else {
        let response = Response::from_string("Not found")
            .with_status_code(StatusCode(404))
            .with_header(content_type_header("text/plain; charset=utf-8"));
        let _ = request.respond(response);
        return;
    };

    let selected = match confined_file(web_root, &selected) {
        Ok(path) => path,
        Err(message) => {
            let response = Response::from_string(message)
                .with_status_code(StatusCode(403))
                .with_header(content_type_header("text/plain; charset=utf-8"));
            let _ = request.respond(response);
            return;
        }
    };
    let mime = mime_guess::from_path(&selected)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    if head_only {
        let response = Response::empty(StatusCode(200))
            .with_header(content_type_header(&mime))
            .with_header(no_sniff_header());
        let _ = request.respond(response);
        return;
    }

    let response = match fs::read(&selected) {
        Ok(body) => Response::from_data(body)
            .with_status_code(StatusCode(200))
            .with_header(content_type_header(&mime)),
        Err(error) => {
            let response = Response::from_string(format!("Failed to read asset: {error}"))
                .with_status_code(StatusCode(500))
                .with_header(content_type_header("text/plain; charset=utf-8"));
            let _ = request.respond(response);
            return;
        }
    };
    let _ = request.respond(response.with_header(no_sniff_header()));
}

#[cfg(not(debug_assertions))]
fn content_type_header(value: &str) -> Header {
    Header::from_bytes("Content-Type", value).expect("static Content-Type header is valid")
}

#[cfg(not(debug_assertions))]
fn cache_control_header(value: &str) -> Header {
    Header::from_bytes("Cache-Control", value).expect("static Cache-Control header is valid")
}

#[cfg(not(debug_assertions))]
fn no_sniff_header() -> Header {
    Header::from_bytes("X-Content-Type-Options", "nosniff")
        .expect("static security header is valid")
}

#[cfg(not(debug_assertions))]
fn validate_web_root(web_root: &Path) -> Result<(), String> {
    if !web_root.join("index.html").is_file() {
        return Err(format!(
            "Packaged student dashboard is missing index.html at {}",
            web_root.display()
        ));
    }
    Ok(())
}

#[cfg(any(not(debug_assertions), test))]
fn safe_relative_path(url: &str) -> Result<PathBuf, String> {
    let raw_path = url.split('?').next().unwrap_or("/");
    let decoded = urlencoding::decode(raw_path)
        .map_err(|_| "The requested path contains invalid URL encoding.".to_string())?;
    if decoded.contains('\0') || decoded.contains('\\') {
        return Err("The requested path is invalid.".to_string());
    }

    let mut relative = PathBuf::new();
    for component in Path::new(decoded.trim_start_matches('/')).components() {
        match component {
            Component::Normal(segment) => relative.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Directory traversal is not allowed.".to_string());
            }
        }
    }
    Ok(relative)
}

#[cfg(not(debug_assertions))]
fn confined_file(web_root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let canonical_root = web_root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve dashboard root: {error}"))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve dashboard asset: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err("The requested asset is outside the dashboard directory.".to_string());
    }
    Ok(canonical_candidate)
}

#[cfg(any(not(debug_assertions), test))]
fn should_use_spa_fallback(relative_path: &Path) -> bool {
    relative_path.as_os_str().is_empty() || relative_path.extension().is_none()
}

pub fn build_dashboard_url(host: &str, port: u16) -> String {
    format!("http://{host}:{port}")
}

#[tauri::command]
pub fn get_student_dashboard_status(
    state: State<'_, LanWebServerState>,
) -> Result<StudentDashboardStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub fn refresh_student_dashboard_address(
    state: State<'_, LanWebServerState>,
) -> Result<StudentDashboardStatus, String> {
    state.refresh_address()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_url_uses_configured_host_and_port() {
        assert_eq!(
            build_dashboard_url("192.168.137.1", STUDENT_DASHBOARD_PORT),
            "http://192.168.137.1:1420"
        );
        assert_eq!(STUDENT_DASHBOARD_PORT, 1420);
        assert_eq!(BACKEND_PORT, 18080);
    }

    #[test]
    fn safe_path_decodes_spaces_and_rejects_traversal() {
        assert_eq!(
            safe_relative_path("/assets/ResQ%20Logo.svg?cache=1").unwrap(),
            PathBuf::from("assets").join("ResQ Logo.svg")
        );
        assert!(safe_relative_path("/../secret.txt").is_err());
        assert!(safe_relative_path("/%2e%2e/secret.txt").is_err());
        assert!(safe_relative_path("/..%5csecret.txt").is_err());
    }

    #[test]
    fn spa_fallback_applies_to_routes_but_not_missing_assets() {
        assert!(should_use_spa_fallback(Path::new(
            "trainee/sessions/session-1/live"
        )));
        assert!(should_use_spa_fallback(Path::new("")));
        assert!(!should_use_spa_fallback(Path::new("assets/missing.js")));
    }

    #[test]
    fn network_status_constructs_dashboard_and_backend_urls() {
        let status =
            LanWebServerState::status_for_network(true, Some("10.0.0.5".to_string()), None);
        assert_eq!(status.url.as_deref(), Some("http://10.0.0.5:1420"));
        assert_eq!(status.backend_url.as_deref(), Some("http://10.0.0.5:18080"));
    }

    #[test]
    fn stop_is_idempotent_without_a_running_server() {
        let state = LanWebServerState::default();
        assert!(!state.stop().unwrap().running);
        assert!(!state.stop().unwrap().running);
    }
}
