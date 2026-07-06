use local_ip_address::list_afinet_netifas;
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    app_name: String,
    app_version: String,
    platform: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    hostname: String,
    primary_ipv4: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisioningConfig {
    wifi_ssid: String,
    wifi_password: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        app_name: "ResQ Local Hub".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
pub fn get_network_info() -> Result<NetworkInfo, String> {
    let hostname = hostname::get()
        .map_err(|error| format!("Failed to read network info: {error}"))?
        .to_string_lossy()
        .to_string();

    // Try hard to find a useful LAN IPv4 while avoiding loopback and link-local first.
    let primary_ipv4 = list_afinet_netifas()
        .ok()
        .and_then(|interfaces| pick_best_ipv4(&interfaces))
        .or_else(detect_ipv4_via_udp)
        .map(|ip| ip.to_string());

    Ok(NetworkInfo {
        hostname,
        primary_ipv4,
    })
}

fn pick_best_ipv4(interfaces: &[(String, IpAddr)]) -> Option<Ipv4Addr> {
    // First pass: ignore loopback + link-local to prefer actual LAN addresses.
    let pass_one = best_candidate(interfaces, false);
    if pass_one.is_some() {
        return pass_one;
    }

    // Fallback: allow link-local if nothing better exists.
    best_candidate(interfaces, true)
}

fn best_candidate(interfaces: &[(String, IpAddr)], allow_link_local: bool) -> Option<Ipv4Addr> {
    interfaces
        .iter()
        .filter_map(|(name, ip)| match ip {
            IpAddr::V4(v4) => Some((name, *v4)),
            IpAddr::V6(_) => None,
        })
        .filter(|(_, ip)| !ip.is_loopback() && !ip.is_unspecified())
        .filter(|(_, ip)| allow_link_local || !is_link_local_ipv4(*ip))
        .max_by_key(|(name, ip)| score_ipv4(name, *ip))
        .map(|(_, ip)| ip)
}

fn score_ipv4(interface_name: &str, ip: Ipv4Addr) -> i32 {
    let mut score = 0;

    if ip.is_private() {
        score += 100;
    }

    if is_link_local_ipv4(ip) {
        score -= 50;
    }

    let lowered = interface_name.to_lowercase();
    if lowered.contains("ethernet") || lowered.contains("wi-fi") || lowered.contains("wlan") {
        score += 10;
    }

    if lowered.contains("virtual") || lowered.contains("vethernet") {
        score -= 10;
    }

    score
}

fn is_link_local_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 169 && octets[1] == 254
}

fn detect_ipv4_via_udp() -> Option<Ipv4Addr> {
    // UDP connect does not send traffic immediately; it lets us query the selected outbound local IP.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;

    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

#[derive(Serialize)]
pub struct ProvisioningData {
    wifi_ssid: String,
    wifi_password: String,
    backend_base_url: String,
    provisioning_url: String,
    provisioning_json: String,
    esp_setup_base_url: String,
    esp_provision_path: String,
    auto_save: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardUrls {
    instructor_url: String,
    trainee_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceLogPaths {
    log_dir: String,
    backend_log_path: String,
    broker_log_path: String,
}

#[tauri::command]
pub fn get_provisioning_data(app: AppHandle) -> Result<ProvisioningData, String> {
    let backend_host = get_network_info()?
        .primary_ipv4
        .ok_or("Failed to detect LAN IP")?;

    let config = load_provisioning_config(&app)?;
    let wifi_ssid = config.wifi_ssid;
    let wifi_password = config.wifi_password;
    let backend_base_url = format!("http://{}:18080", backend_host);
    let esp_setup_base_url = "http://192.168.4.1".to_string();
    let esp_provision_path = "/".to_string();
    let auto_save = true;

    let mut provisioning_url = format!(
        "{}{path}?wifi_ssid={}&wifi_pass={}&backend_base_url={}",
        esp_setup_base_url,
        urlencoding::encode(&wifi_ssid),
        urlencoding::encode(&wifi_password),
        urlencoding::encode(&backend_base_url),
        path = esp_provision_path,
    );

    if auto_save {
        provisioning_url.push_str("&auto=1");
    }

    let provisioning_json = serde_json::json!({
        "wifi_ssid": &wifi_ssid,
        "wifi_pass": &wifi_password,
        "backend_base_url": &backend_base_url,
    })
    .to_string();

    Ok(ProvisioningData {
        wifi_ssid,
        wifi_password,
        backend_base_url,
        provisioning_url,
        provisioning_json,
        esp_setup_base_url,
        esp_provision_path,
        auto_save,
    })
}

#[tauri::command]
pub fn get_dashboard_urls(chosen_host: String, web_port: u16) -> DashboardUrls {
    DashboardUrls {
        instructor_url: format!("http://{}:{}/instructor", chosen_host, web_port),
        trainee_url: format!("http://{}:{}/trainee", chosen_host, web_port),
    }
}

#[tauri::command]
pub fn get_service_log_paths(app: tauri::AppHandle) -> Result<ServiceLogPaths, String> {
    let log_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
        .join("logs");

    std::fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create log directory at {}: {error}", log_dir.display()))?;

    let backend_log_path = log_dir.join("hub-api.log");
    let broker_log_path = log_dir.join("mosquitto.log");

    Ok(ServiceLogPaths {
        log_dir: path_to_string(log_dir),
        backend_log_path: path_to_string(backend_log_path),
        broker_log_path: path_to_string(broker_log_path),
    })
}

#[tauri::command]
pub fn refresh_pairing_token() -> Result<String, String> {
    fetch_pairing_token()
}

#[tauri::command]
pub fn save_provisioning_config(
    app: AppHandle,
    wifi_ssid: String,
    wifi_password: String,
) -> Result<ProvisioningConfig, String> {
    let config = ProvisioningConfig {
        wifi_ssid: wifi_ssid.trim().to_string(),
        wifi_password,
    };

    validate_provisioning_config(&config)?;

    let path = provisioning_config_path(&app)?;
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize provisioning config: {error}"))?;

    fs::write(&path, raw)
        .map_err(|error| format!("Failed to save provisioning config at {}: {error}", path.display()))?;

    Ok(config)
}

fn fetch_pairing_token() -> Result<String, String> {
    let url = "http://localhost:18080/api/manikins/pair-request";

    match ureq::post(url).call() {
        Ok(response) => {
            match serde_json::from_reader(response.into_reader()) {
                Ok::<serde_json::Value, _>(json) => {
                    json
                        .get("token")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string())
                        .ok_or("Token not found in response".to_string())
                }
                Err(e) => Err(format!("Failed to parse response: {}", e)),
            }
        }
        Err(_e) => {
            // Fallback: Generate a mock token for development when backend is unavailable
            use std::time::{SystemTime, UNIX_EPOCH};
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Ok(format!("dev-token-{}", timestamp))
        }
    }
}

fn path_to_string(path: PathBuf) -> String {
    path.display().to_string()
}

fn provisioning_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve application data directory: {error}"))?;

    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "Failed to create application data directory at {}: {error}",
            config_dir.display()
        )
    })?;

    Ok(config_dir.join("provisioning-config.json"))
}

fn load_provisioning_config(app: &AppHandle) -> Result<ProvisioningConfig, String> {
    let path = provisioning_config_path(app)?;

    if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read provisioning config: {error}"))?;

        let config: ProvisioningConfig = serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse provisioning config: {error}"))?;

        validate_provisioning_config(&config)?;
        return Ok(config);
    }

    // Development-only fallback through environment variables.
    // Do not hardcode a password in release builds.
    let wifi_ssid = std::env::var("RESQ_PROVISION_WIFI_SSID").unwrap_or_default();
    let wifi_password = std::env::var("RESQ_PROVISION_WIFI_PASSWORD").unwrap_or_default();

    let config = ProvisioningConfig {
        wifi_ssid,
        wifi_password,
    };

    validate_provisioning_config(&config)?;
    Ok(config)
}

fn validate_provisioning_config(config: &ProvisioningConfig) -> Result<(), String> {
    if config.wifi_ssid.trim().is_empty() {
        return Err("Provisioning Wi-Fi SSID is not configured".to_string());
    }

    if config.wifi_password.trim().is_empty() {
        return Err("Provisioning Wi-Fi password is not configured".to_string());
    }

    Ok(())
}