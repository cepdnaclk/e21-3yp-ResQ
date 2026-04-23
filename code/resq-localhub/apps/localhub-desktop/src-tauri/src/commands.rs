use local_ip_address::list_afinet_netifas;
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};

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
