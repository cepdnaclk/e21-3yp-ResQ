# ResQ Smart CPR Training System
## Short User Manual - Version 1.0

**Product:** ResQ CPR Training Overlay and LocalHub  
**Intended users:** Instructors, trainees, administrators, and technicians  
**Purpose:** Provide real-time, objective feedback during manikin-based CPR training.

> **Important:** ResQ is a training and education system. It is not intended for patient care, clinical diagnosis, treatment, or emergency decision-making.

---

## 1. System Overview

ResQ combines:

- A sensor-equipped CPR manikin overlay.
- An ESP32-C3 controller with two buttons, two status LEDs, and a buzzer.
- A Windows **ResQ LocalHub** application.
- Instructor and trainee dashboards.
- A local MQTT broker and local database.
- Optional cloud synchronization when internet access is available.

The system measures and reports:

- Compression depth.
- Compression rate.
- Full chest recoil.
- Pauses and interruptions.
- Hand-placement balance.
- Compression count and session score.

---

## 2. Before You Begin

Ensure that:

1. The ResQ overlay is correctly fitted to the training manikin.
2. The controller is powered.
3. The instructor computer and manikin use the same Wi-Fi router or hotspot.
4. The instructor computer has the ResQ LocalHub application installed.
5. **SENSOR mode** is selected for normal CPR operation. USB mode is for maintenance and testing.
6. No pressure is applied to the chest overlay before calibration begins.

> Internet access is not required for live training. A working local Wi-Fi network is required.

---

## 3. Device Controls

| Control | Normal use |
|---|---|
| **State LED** | Shows the main firmware and connection state. |
| **Activity LED** | Shows readiness, calibration, session, or error activity. |
| **Buzzer** | Provides an approximately 110-compressions-per-minute cadence during a session. |
| **Button 1 - short press** | Retry or continue the current recoverable operation. |
| **Button 2 - short press** | Cancel, return to idle, or clear network settings when instructed. |
| **Button 1 - long press** | Safely stop the device and enter software turn-off mode. |
| **Button 2 - long press** | Perform a factory reset and restart provisioning. |

A long press must be held for at least **3 seconds** and then released. Button behavior depends on the current device state; use LocalHub controls whenever available.

---

## 4. Start the LocalHub

1. Open **ResQ LocalHub** on the instructor Windows computer.
2. Select **Start Services**.
3. Confirm that the following services show **Running/Healthy**:
   - MQTT broker.
   - Local backend.
   - Dashboard service.
4. Confirm that LocalHub displays the correct LAN IP address and dashboard access details.
5. Keep LocalHub running throughout the training session.

---

## 5. First-Time Device Setup and Pairing

1. Power the ResQ controller.
2. When the device enters provisioning mode, connect the instructor device to the displayed **ResQ setup Wi-Fi** if prompted.
3. In LocalHub, open **Add/Pair Manikin** and scan the QR code printed on the device.
4. The required Wi-Fi and LocalHub connection details are filled automatically. Review them and select **Save Configuration**.
5. Select **SENSOR mode** when prompted.
6. The device restarts, joins the local Wi-Fi network, registers with LocalHub, and connects to MQTT.
7. Confirm that the manikin appears as **Online/Paired** in the Instructor Dashboard.

If the device does not appear, confirm that the controller and instructor computer are connected to the same local network, then retry pairing.

---

## 6. User Login and Roles

Log in using the account provided by the administrator.

| Role | Main access |
|---|---|
| **Administrator** | User accounts, roles, settings, devices, and audit information. |
| **Instructor** | Pair devices, calibrate, start/stop sessions, monitor trainees, review and export results. |
| **Trainee** | View personal live feedback and permitted session history. |
| **Technician** | Diagnostics, calibration support, reset, and device maintenance. |
| **Viewer/Evaluator** | Read-only access to permitted dashboards and reports. |

Protected actions are controlled by role and may not be available to every user.

---

## 7. Calibration and Readiness Check

Calibration must be completed before a scored CPR session.

1. Select the required manikin in the Instructor Dashboard.
2. Confirm that no one is pressing or leaning on the overlay.
3. Select **Run Calibration / Pre-Check**.
4. Follow the displayed steps for:
   - Rest position and sensor stability.
   - Reference pressure.
   - Compression depth.
   - Full release/recoil.
   - Hand-placement balance.
5. Keep the manikin stable until LocalHub reports the result.
6. Begin a session only when the device status is **Ready for Session**.

If calibration fails:

- Remove all pressure from the overlay.
- Check the sensor connections and bladder condition.
- Retry calibration from LocalHub or use Button 1 when instructed.
- Do not start a scored session until calibration passes.

---

## 8. Start a CPR Training Session

1. Open the **Instructor Dashboard**.
2. Select the trainee and the ready manikin.
3. Select the required training profile or session settings.
4. Select **Start Session**.
5. Confirm that both LEDs indicate an active session and the buzzer begins the cadence.
6. The trainee performs CPR while the dashboard shows live feedback.

During the session, LocalHub displays:

- Current compression depth.
- Compression rate in compressions per minute.
- Recoil quality.
- Pause duration.
- Hand-placement balance.
- Compression count.
- Live coaching flags and alerts.

The trainee should follow the approved CPR technique taught by the instructor. ResQ feedback supports instruction; it does not replace the instructor.

---

## 9. End and Review a Session

1. Select **Stop Session** in LocalHub.
2. Wait until the device returns to **Ready for Session**.
3. Open **Recent Sessions** or **Session Details**.
4. Review:
   - Overall score.
   - Average depth and rate.
   - Valid compression count.
   - Recoil performance.
   - Pauses and interruptions.
   - Hand-placement warnings.
   - Improvement areas.
5. Export the session as **CSV** or **JSON** when required.

If a session is interrupted by a power, Wi-Fi, MQTT, or application failure, LocalHub stores available data and marks the session as interrupted or partial where possible.

---

## 10. Main LED Patterns

| State LED | Activity LED | Meaning | Required action |
|---|---|---|---|
| **ON** | **OFF** | Connected but not calibrated or not ready. | Run calibration from LocalHub. |
| **OFF** | **ON** | Ready for a training session. | Start the session from LocalHub. |
| **ON** | **ON** | Session active. | Perform CPR and monitor the dashboard. |
| **ON** | **Medium blink** | Calibration is running. | Follow LocalHub prompts and keep the manikin stable. |
| **ON** | **Fast blink** | Calibration failed or the session was interrupted. | Read the LocalHub message and retry or return to idle. |
| **Fast blink** | **Fast blink** | Firmware or system error. | Retry, restart services, or reconfigure as instructed. |
| **Slow blink** | Varies | Startup, Wi-Fi connection, shutdown, or transition. | Wait for the device to complete the operation. |

Always identify the LEDs by the **State** and **Activity** labels rather than by colour alone.

---

## 11. Connection Loss, Shutdown, and Reset

### Connection loss during a session

- The firmware stops normal session processing safely.
- LocalHub marks the session as interrupted where applicable.
- Restore Wi-Fi and LocalHub services.
- Confirm that the device returns online and ready.
- Start a new session if the interrupted session cannot continue.

### Normal shutdown

1. Stop any active session in LocalHub.
2. Select **Stop Services** in LocalHub when training is complete.
3. Hold **Button 1** for at least 3 seconds and release, or disconnect power after the device has safely stopped.

### Reconfigure network

Use the LocalHub **Unpair/Clear Network** action or the instructed Button 2 short-press recovery option. The device returns to provisioning mode.

### Factory reset

Hold **Button 2** for at least 3 seconds and release. A factory reset clears saved configuration and requires complete first-time setup again.

---

## 12. Local Storage, Privacy, and Cloud Sync

- Live training and session storage operate locally using the LocalHub database.
- Internet access is not required for normal sessions.
- User access is role-based.
- Session data is stored on the instructor computer according to institutional policy.
- Optional cloud synchronization runs only when a reliable internet connection is available and does not block local training.
- Do not share login credentials or exported trainee records with unauthorized persons.

---

## 13. Care and Maintenance

- Use ResQ only with a training manikin.
- Keep the controller, sensor electronics, and connectors dry.
- Do not immerse the overlay or electronics in liquid.
- Avoid sharp objects, excessive loads, and unsupported disassembly.
- Inspect the overlay, straps, air bladder, cables, and enclosure before use.
- Stop using the unit if there is visible damage, leakage, loose wiring, unusual heat, or repeated sensor failure.
- Follow the cleaning method approved for the final overlay material and the base manikin.
- Calibration should be repeated after mechanical adjustment, sensor replacement, transport damage, or major configuration changes.

---

## 14. Troubleshooting

| Problem | Check and action |
|---|---|
| LocalHub services do not start | Close duplicate instances, check for port conflicts, restart LocalHub, and try **Start Services** again. |
| Manikin is not shown online | Check power, same Wi-Fi network, LocalHub services, router coverage, and MQTT connection. |
| QR setup fails | Clean and rescan the label, allow camera access, and use the manual device identifier option if available. |
| Device remains in provisioning | Confirm the saved Wi-Fi details and LocalHub address, then save configuration again. |
| Start Session is disabled | Confirm the device is paired, online, in SENSOR mode, and successfully calibrated. |
| No live measurements | Confirm that a session is active, sensors are connected, and the device is publishing telemetry. |
| Calibration repeatedly fails | Remove all chest pressure, check bladder/sensor connections, inspect for damage, and contact a technician. |
| Both LEDs blink rapidly | Read the LocalHub error, retry the operation, restart services, or reset/reprovision if instructed. |
| Session stops unexpectedly | Restore power/network/services, review the interrupted session record, and begin a new session when ready. |

---

## 15. Daily Operating Checklist

1. Inspect the overlay, enclosure, straps, cables, and power connection.
2. Start LocalHub services and confirm all services are healthy.
3. Power the manikin and confirm it appears online.
4. Confirm **SENSOR mode**.
5. Run calibration and wait for **Ready for Session**.
6. Select the trainee and start the session from LocalHub.
7. Monitor live feedback and stop the session from LocalHub.
8. Review and export results if required.
9. Stop LocalHub services and power down the device safely.

---

## 16. Support Information

Record the following before requesting technical support:

- Device ID/manikin ID.
- LocalHub application version.
- Firmware version.
- Current LED pattern.
- Error or reason code shown in LocalHub.
- Whether Wi-Fi, MQTT, and backend services are connected.
- Steps performed before the problem occurred.

**Project:** ResQ Smart CPR Training System  
**Department:** Department of Computer Engineering, University of Peradeniya
