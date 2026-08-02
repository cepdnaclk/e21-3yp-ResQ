# Student tablet access

ResQ LocalHub serves the compiled student dashboard directly from the installed Tauri application. The instructor PC and student tablet only need to share a local network; internet access and Node.js are not required on the installed PC.

## Connect a tablet

1. Start **ResQ Local Hub** and wait for the backend and dashboard status to become available.
2. Connect the instructor PC and tablet to the same Wi-Fi network or Windows mobile hotspot.
3. On the LocalHub Overview page, find **Student Tablet Access**.
4. Scan the general dashboard QR code, or select **Copy Link** and open the link on the tablet.
5. Sign in using the assigned trainee account.
6. Open the active session. When LocalHub shows an authorized session-specific QR, the trainee can scan it and sign in before opening that session.
7. Keep LocalHub running for the full training session.

The URL uses the instructor PC's current private IPv4 address, for example `http://192.168.8.100:1420`. Select **Refresh Network** after changing Wi-Fi, enabling a hotspot, connecting Ethernet, or disconnecting a VPN.

## Network ports

| Port | Purpose | Used by tablet browser |
| ---: | --- | :---: |
| `1420` | Compiled React dashboard served by Tauri | Yes |
| `18080` | Spring Boot REST and SSE backend | Yes |
| `1883` | MQTT communication between devices and LocalHub services | No |

The release server binds ports `1420` and `18080` to the local network. The MQTT broker is not used by the student browser.

## Windows Firewall

When Windows prompts for network access, allow **ResQ Local Hub** on private networks. Do not disable Windows Firewall globally.

If a private-network rule must be added manually, open PowerShell as Administrator and run:

```powershell
New-NetFirewallRule `
  -DisplayName "ResQ LocalHub Student Dashboard" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 1420,18080 `
  -Profile Private
```

This rule deliberately does not expose MQTT port `1883` to tablet browsers.

## Troubleshooting

### QR URL does not open

- Confirm the tablet and PC are on the same Wi-Fi or hotspot.
- Select **Refresh Network** and scan the newly generated QR code.
- Check that the displayed URL contains a private address beginning with `10.`, `172.16`–`172.31`, or `192.168`.
- Disable a VPN temporarily if it is taking priority over the physical network adapter.
- Check whether the router has AP isolation, client isolation, or guest-network isolation enabled.

### Backend is unavailable

- Keep LocalHub open and wait for the backend status to become available.
- From the instructor PC, open `http://127.0.0.1:18080/api/hub/health`.
- Confirm another application is not already using port `18080`.

### Dashboard server cannot start

- Close any process already using port `1420`, then restart LocalHub.
- Inspect listeners with:

  ```powershell
  Get-NetTCPConnection -State Listen |
    Where-Object LocalPort -In 1420,18080 |
    Select-Object LocalAddress, LocalPort, OwningProcess
  ```

### Page opens but live data does not update

- Confirm both `http://<LAN-IP>:1420/localhub-web-health` and `http://<LAN-IP>:18080/api/hub/health` respond from the tablet network.
- Check Windows Firewall private-network access for ports `1420` and `18080`.
- Refresh the tablet page after the instructor PC's LAN address changes.
- Verify the trainee signed in with the account assigned to the active session.

The dashboard server supports direct refreshes of React routes such as `/trainee/sessions/<session-id>/live`; those routes return the application entry page rather than a 404 response.
