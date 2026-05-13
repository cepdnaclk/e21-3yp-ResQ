WIFI Connect Retry Policy

Summary
- On boot, when entering `WIFI_CONNECTING` using saved credentials from NVS, firmware will attempt to connect up to 5 times.
- There is a 60 second delay between failed attempts.
- If all 5 attempts fail, firmware clears saved Wi‑Fi provisioning data (Wi‑Fi SSID/password and provisioning network fields) and sets `provisioned=false` in NVS, then reboots.
- On next boot the device will enter the provisioning / SoftAP flow.

Behavior details
- Boot-time constants:
  - `WIFI_BOOT_MAX_RETRIES = 5`
  - `WIFI_BOOT_RETRY_DELAY_MS = 60000`
- The device preserves device identity, calibration defaults, and unrelated runtime tuning values when clearing provisioning; only Wi‑Fi/provisioning-related keys are removed.
- The firmware does not log Wi‑Fi passwords.

Manual verification steps
1. Provision device with intentionally incorrect Wi‑Fi password.
2. Reboot the device.
3. Observe the firmware log and status indicator:
   - Device should enter `WIFI_CONNECTING`.
   - Logs should show: "Wi‑Fi connect attempt 1/5", then on failure "Wi‑Fi connect failed; retrying in 60 seconds".
4. Confirm the firmware repeats attempts 2..5 with ~60s gaps.
5. After attempt 5 fails, confirm the log: "Wi‑Fi failed after 5 attempts; clearing saved Wi‑Fi config and returning to provisioning".
6. Confirm the device reboots and, on next boot, enters provisioning / SoftAP mode.

Successful connection test
1. Provision device with correct Wi‑Fi credentials.
2. Reboot the device.
3. Confirm the device connects successfully before hitting retry limit and continues to backend registration and MQTT startup.

Notes for developers
- The implementation uses `wifi_manager_connect_sta(...)` which returns `ESP_OK` on success, and non-`ESP_OK` on failure or timeout.
- Clearing provisioning calls `config_store_clear_wifi_provisioning()` which erases Wi‑Fi SSID/password and provisioning-related network keys and sets the provisioned flag to false.
- If further changes to provisioning keys are needed (e.g. clearing auth tokens), update `config_store_clear_wifi_provisioning()` accordingly.
