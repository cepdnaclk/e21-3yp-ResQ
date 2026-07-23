use std::{
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::{io::AsRawHandle, process::CommandExt};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const LOCALHUB_OWNER: &str = "resq-localhub";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct ProcessInfo {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: Option<String>,
    pub executable_path: Option<PathBuf>,
    pub command_line: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMetadata {
    pub pid: u32,
    pub service: String,
    pub executable_path: PathBuf,
    pub command_line: Vec<String>,
    pub started_by: String,
    pub started_at_unix_ms: u128,
}

#[derive(Debug)]
pub struct ManagedProcess {
    pub name: String,
    pub child: Option<Child>,
    pub pid: Option<u32>,
    pub executable_path: PathBuf,
    pub command_line: Vec<String>,
    pub pid_file: Option<PathBuf>,
    pub ports: Vec<u16>,
}

impl ManagedProcess {
    pub fn from_child(
        name: impl Into<String>,
        child: Child,
        executable_path: PathBuf,
        command_line: Vec<String>,
        pid_file: Option<PathBuf>,
        ports: Vec<u16>,
    ) -> Self {
        let pid = child.id();
        Self {
            name: name.into(),
            child: Some(child),
            pid: Some(pid),
            executable_path,
            command_line,
            pid_file,
            ports,
        }
    }

    pub fn metadata(&self) -> Option<ProcessMetadata> {
        Some(ProcessMetadata {
            pid: self.pid?,
            service: self.name.clone(),
            executable_path: self.executable_path.clone(),
            command_line: self.command_line.clone(),
            started_by: LOCALHUB_OWNER.to_string(),
            started_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis())
                .unwrap_or_default(),
        })
    }
}

#[derive(Debug)]
pub struct PortConflict {
    pub port: u16,
    pub owner_pid: Option<u32>,
    pub process_name: Option<String>,
    pub appears_localhub_owned: bool,
}

impl PortConflict {
    pub fn message(&self, service_name: &str) -> String {
        let pid = self
            .owner_pid
            .map(|pid| pid.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let process_name = self
            .process_name
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let ownership = if self.appears_localhub_owned {
            "The process matched LocalHub ownership metadata but cleanup failed."
        } else {
            "The process was not verified as LocalHub-owned, so it was not terminated automatically."
        };

        format!(
            "Port {} is already in use by PID {} ({}). {} {} needs this port. Stop the conflicting process or change the configured port.",
            self.port, pid, process_name, ownership, service_name
        )
    }
}

pub fn runtime_pid_file(app: &tauri::AppHandle, service_name: &str) -> Result<PathBuf, String> {
    let runtime_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
        .join("runtime")
        .join("pids");
    fs::create_dir_all(&runtime_dir).map_err(|error| {
        format!(
            "Failed to create PID metadata directory at {}: {error}",
            runtime_dir.display()
        )
    })?;
    Ok(runtime_dir.join(format!("{service_name}.json")))
}

pub fn persist_metadata(process: &ManagedProcess) -> Result<(), String> {
    let Some(pid_file) = &process.pid_file else {
        return Ok(());
    };
    let Some(metadata) = process.metadata() else {
        return Ok(());
    };

    if let Some(parent) = pid_file.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create PID metadata directory at {}: {error}",
                parent.display()
            )
        })?;
    }

    let body = serde_json::to_string_pretty(&metadata)
        .map_err(|error| format!("Failed to serialize {} PID metadata: {error}", process.name))?;
    fs::write(pid_file, body).map_err(|error| {
        format!(
            "Failed to write {} PID metadata at {}: {error}",
            process.name,
            pid_file.display()
        )
    })
}

pub fn remove_pid_file(pid_file: &Path) {
    match fs::remove_file(pid_file) {
        Ok(()) => eprintln!("Removed stale PID metadata path={}", pid_file.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => eprintln!(
            "Failed to remove PID metadata path={} error={error}",
            pid_file.display()
        ),
    }
}

pub fn hide_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn is_port_listening(port: u16) -> bool {
    let Ok(mut addrs) = format!("127.0.0.1:{port}").to_socket_addrs() else {
        return false;
    };
    let Some(socket_addr) = addrs.next() else {
        return false;
    };

    TcpStream::connect_timeout(&socket_addr, Duration::from_millis(350)).is_ok()
}

pub fn wait_until_port_free(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !is_port_listening(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }

    !is_port_listening(port)
}

pub fn ensure_port_available_or_recover_stale(
    port: u16,
    service_name: &str,
    pid_file: &Path,
) -> Result<(), String> {
    if !is_port_listening(port) {
        cleanup_dead_metadata(pid_file);
        return Ok(());
    }

    let owner_pid = find_tcp_listen_owner_pid(port);
    let owner_info = owner_pid.and_then(process_info);
    let appears_localhub_owned = owner_info
        .as_ref()
        .is_some_and(|info| verified_stale_owner(pid_file, info));

    if appears_localhub_owned {
        if let Some(root_pid) = stale_root_pid(pid_file) {
            eprintln!(
                "Verified stale LocalHub-owned process service={} port={} root_pid={}",
                service_name, port, root_pid
            );
            terminate_process_tree(root_pid, service_name)?;
            if wait_until_port_free(port, Duration::from_secs(8)) {
                remove_pid_file(pid_file);
                eprintln!("Port {port} released after stale {service_name} cleanup");
                return Ok(());
            }
            return Err(format!(
                "Verified stale LocalHub-owned {service_name} process was terminated, but port {port} did not become free."
            ));
        }
    }

    let conflict = PortConflict {
        port,
        owner_pid,
        process_name: owner_info.as_ref().and_then(|info| info.name.clone()),
        appears_localhub_owned,
    };
    eprintln!(
        "Unverified process owns port {}; refusing automatic termination pid={:?} process={:?}",
        port, conflict.owner_pid, conflict.process_name
    );
    Err(conflict.message(service_name))
}

pub fn cleanup_dead_metadata(pid_file: &Path) {
    let Some(metadata) = read_metadata(pid_file) else {
        return;
    };
    if process_info(metadata.pid).is_none() {
        remove_pid_file(pid_file);
    }
}

pub fn read_metadata(pid_file: &Path) -> Option<ProcessMetadata> {
    let body = fs::read_to_string(pid_file).ok()?;
    serde_json::from_str(&body).ok()
}

fn stale_root_pid(pid_file: &Path) -> Option<u32> {
    read_metadata(pid_file)
        .filter(|metadata| metadata.started_by == LOCALHUB_OWNER)
        .map(|metadata| metadata.pid)
}

pub fn verified_stale_owner(pid_file: &Path, owner_info: &ProcessInfo) -> bool {
    let Some(metadata) = read_metadata(pid_file) else {
        return false;
    };
    if metadata.started_by != LOCALHUB_OWNER {
        return false;
    }

    let Some(root_info) = process_info(metadata.pid) else {
        return false;
    };

    let root_matches = process_matches_metadata(&metadata, &root_info);
    root_matches
        && (owner_info.pid == metadata.pid || is_descendant_of(owner_info.pid, metadata.pid))
}

fn process_matches_metadata(metadata: &ProcessMetadata, process: &ProcessInfo) -> bool {
    let executable_matches = process
        .executable_path
        .as_ref()
        .is_some_and(|path| same_path(path, &metadata.executable_path));

    let command_matches = process.command_line.as_ref().is_some_and(|command_line| {
        metadata
            .command_line
            .iter()
            .filter(|part| !part.trim().is_empty())
            .all(|part| command_line.contains(part))
    });

    executable_matches && command_matches
}

fn same_path(left: &Path, right: &Path) -> bool {
    fn normalize(path: &Path) -> String {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_ascii_lowercase()
    }
    if normalize(left) == normalize(right) {
        return true;
    }

    if right.components().count() == 1 {
        return left
            .file_name()
            .zip(right.file_name())
            .is_some_and(|(left, right)| {
                left.to_string_lossy()
                    .eq_ignore_ascii_case(&right.to_string_lossy())
            });
    }

    false
}

fn is_descendant_of(pid: u32, ancestor_pid: u32) -> bool {
    let mut current = Some(pid);
    for _ in 0..32 {
        let Some(current_pid) = current else {
            return false;
        };
        if current_pid == ancestor_pid {
            return true;
        }
        current = process_info(current_pid).and_then(|info| info.parent_pid);
    }
    false
}

pub fn terminate_managed_process(process: &mut ManagedProcess) -> Result<(), String> {
    let pid = process
        .pid
        .or_else(|| process.child.as_ref().map(Child::id));
    eprintln!("Stopping service: {} pid={pid:?}", process.name);

    if let Some(child) = process.child.as_mut() {
        if child
            .try_wait()
            .map_err(|error| format!("Failed to query {} status: {error}", process.name))?
            .is_none()
        {
            if let Some(pid) = pid {
                terminate_process_tree(pid, &process.name)?;
            } else {
                child
                    .kill()
                    .map_err(|error| format!("Failed to stop {}: {error}", process.name))?;
            }
        }

        match child.wait() {
            Ok(status) => eprintln!(
                "Service process exited: {} pid={pid:?} status={status}",
                process.name
            ),
            Err(error) => eprintln!(
                "Failed to wait for service process: {} pid={pid:?} error={error}",
                process.name
            ),
        }
    } else if let Some(pid) = pid {
        terminate_process_tree(pid, &process.name)?;
    }

    for port in &process.ports {
        if wait_until_port_free(*port, Duration::from_secs(8)) {
            eprintln!("Port {} released for service {}", port, process.name);
        } else {
            eprintln!(
                "Port {} was still listening after stopping service {}",
                port, process.name
            );
            return Err(format!(
                "{} stopped but port {} did not become free",
                process.name, port
            ));
        }
    }

    if let Some(pid_file) = &process.pid_file {
        remove_pid_file(pid_file);
    }
    process.child = None;
    process.pid = None;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn terminate_process_tree(pid: u32, service_name: &str) -> Result<(), String> {
    if process_info(pid).is_none() {
        eprintln!("Process already exited: service={service_name} pid={pid}");
        return Ok(());
    }

    eprintln!("Terminating process tree gracefully: service={service_name} pid={pid}");
    let graceful = taskkill(pid, false);
    if graceful.is_ok() {
        thread::sleep(Duration::from_millis(700));
        if process_info(pid).is_none() {
            return Ok(());
        }
    } else {
        eprintln!("Graceful stop timed out or failed for service={service_name} pid={pid}");
    }

    eprintln!("Terminating process tree forcefully: service={service_name} pid={pid}");
    taskkill(pid, true)
}

#[cfg(not(target_os = "windows"))]
pub fn terminate_process_tree(pid: u32, service_name: &str) -> Result<(), String> {
    eprintln!("Terminating process: service={service_name} pid={pid}");
    let status = Command::new("kill")
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("Failed to launch kill for {service_name} pid={pid}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "kill failed for {service_name} pid={pid} with status {status}"
        ))
    }
}

#[cfg(target_os = "windows")]
fn taskkill(pid: u32, force: bool) -> Result<(), String> {
    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if force {
        command.arg("/F");
    }
    hide_window(&mut command);

    let status = command
        .status()
        .map_err(|error| format!("Failed to launch taskkill for pid {pid}: {error}"))?;
    if status.success() || process_info(pid).is_none() {
        Ok(())
    } else {
        Err(format!(
            "taskkill failed for pid {pid} with status {status}"
        ))
    }
}

#[cfg(target_os = "windows")]
pub fn find_tcp_listen_owner_pid(port: u16) -> Option<u32> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let body = String::from_utf8_lossy(&output.stdout);
    parse_netstat_listen_owner(&body, port)
}

#[cfg(not(target_os = "windows"))]
pub fn find_tcp_listen_owner_pid(_port: u16) -> Option<u32> {
    None
}

fn parse_netstat_listen_owner(output: &str, port: u16) -> Option<u32> {
    let suffix = format!(":{port}");
    output.lines().find_map(|line| {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
            return None;
        }
        let local_addr = parts[1];
        let state = parts[3];
        let pid = parts[4];
        (local_addr.ends_with(&suffix) && state.eq_ignore_ascii_case("LISTENING"))
            .then(|| pid.parse::<u32>().ok())
            .flatten()
    })
}

#[cfg(target_os = "windows")]
pub fn process_info(pid: u32) -> Option<ProcessInfo> {
    let filter = format!("ProcessId = {pid}");
    let script = format!(
        "Get-CimInstance Win32_Process -Filter '{}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
        filter.replace('\'', "''")
    );
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let body = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if body.is_empty() || body == "null" {
        return None;
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct CimProcess {
        process_id: u32,
        parent_process_id: Option<u32>,
        name: Option<String>,
        executable_path: Option<PathBuf>,
        command_line: Option<String>,
    }

    let parsed: CimProcess = serde_json::from_str(&body).ok()?;
    Some(ProcessInfo {
        pid: parsed.process_id,
        parent_pid: parsed.parent_process_id,
        name: parsed.name,
        executable_path: parsed.executable_path,
        command_line: parsed.command_line,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn process_info(_pid: u32) -> Option<ProcessInfo> {
    None
}

pub fn assign_child_to_job(child: &Child, service_name: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let job = job_object()?;
        let job = job
            .lock()
            .map_err(|_| "Failed to lock Windows Job Object".to_string())?;
        job.assign(child, service_name)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = child;
        let _ = service_name;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn job_object() -> Result<&'static Mutex<WindowsJobObject>, String> {
    static JOB: OnceLock<Mutex<WindowsJobObject>> = OnceLock::new();
    if let Some(job) = JOB.get() {
        return Ok(job);
    }
    let job = WindowsJobObject::new()?;
    let _ = JOB.set(Mutex::new(job));
    Ok(JOB.get().expect("job object initialized"))
}

#[cfg(target_os = "windows")]
struct WindowsJobObject {
    handle: Handle,
}

#[cfg(target_os = "windows")]
impl WindowsJobObject {
    fn new() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        if handle.0.is_null() {
            return Err(format!(
                "Failed to create Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut info = JobObjectExtendedLimitInformation::default();
        info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = unsafe {
            SetInformationJobObject(
                handle,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &mut info as *mut _ as *mut _,
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            )
        };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(format!(
                "Failed to configure Windows Job Object kill-on-close: {error}"
            ));
        }

        eprintln!("Created LocalHub Windows Job Object with kill-on-close");
        Ok(Self { handle })
    }

    fn assign(&self, child: &Child, service_name: &str) -> Result<(), String> {
        let process_handle = Handle(child.as_raw_handle() as *mut _);
        let ok = unsafe { AssignProcessToJobObject(self.handle, process_handle) };
        if ok == 0 {
            return Err(format!(
                "Failed to assign service {service_name} pid={} to Windows Job Object: {}",
                child.id(),
                std::io::Error::last_os_error()
            ));
        }

        eprintln!(
            "Assigned process to Windows Job Object: service={} pid={}",
            service_name,
            child.id()
        );
        Ok(())
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobObject {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
#[repr(transparent)]
struct Handle(*mut std::ffi::c_void);

#[cfg(target_os = "windows")]
unsafe impl Send for Handle {}

#[cfg(target_os = "windows")]
unsafe impl Sync for Handle {}

#[cfg(target_os = "windows")]
type Bool = i32;

#[cfg(target_os = "windows")]
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

#[cfg(target_os = "windows")]
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Default)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(lp_job_attributes: *mut std::ffi::c_void, lp_name: *const u16) -> Handle;
    fn SetInformationJobObject(
        h_job: Handle,
        job_object_information_class: i32,
        lp_job_object_information: *mut std::ffi::c_void,
        cb_job_object_information_length: u32,
    ) -> Bool;
    fn AssignProcessToJobObject(h_job: Handle, h_process: Handle) -> Bool;
    fn CloseHandle(h_object: Handle) -> Bool;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn parses_netstat_listening_owner() {
        let output = r#"
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:1883           0.0.0.0:0              LISTENING       1234
  TCP    [::]:18080             [::]:0                 LISTENING       5678
"#;

        assert_eq!(parse_netstat_listen_owner(output, 1883), Some(1234));
        assert_eq!(parse_netstat_listen_owner(output, 18080), Some(5678));
        assert_eq!(parse_netstat_listen_owner(output, 9001), None);
    }

    #[test]
    fn port_wait_times_out_while_listener_is_alive() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();

        assert!(!wait_until_port_free(port, Duration::from_millis(250)));
        drop(listener);
        assert!(wait_until_port_free(port, Duration::from_secs(1)));
    }

    #[test]
    fn process_metadata_round_trips() {
        let metadata = ProcessMetadata {
            pid: 42,
            service: "mosquitto".to_string(),
            executable_path: PathBuf::from(r"C:\LocalHub\mosquitto.exe"),
            command_line: vec!["-c".to_string(), "mosquitto.conf".to_string()],
            started_by: LOCALHUB_OWNER.to_string(),
            started_at_unix_ms: 7,
        };

        let body = serde_json::to_string(&metadata).expect("serialize metadata");
        let parsed: ProcessMetadata = serde_json::from_str(&body).expect("parse metadata");
        assert_eq!(parsed.pid, 42);
        assert_eq!(parsed.started_by, LOCALHUB_OWNER);
        assert_eq!(parsed.command_line, metadata.command_line);
    }
}
