# ResQ Cloud & Sync End-to-End Demo Runbook

This document provides a step-by-step verification script to demonstrate the ResQ system end-to-end. Use it to guide the final demo flow and verify all components are operating correctly.

> [!WARNING]
> Do NOT use real passwords, keys, or JWT secrets in this runbook. Use placeholders.

---

## 1. Deployed & Local API Health Checks

Verify that the ResQ Cloud API is online and responding before starting the demo.

### Deployed API Health Check
```powershell
Invoke-RestMethod https://<api-gateway-url>/api/cloud/health | ConvertTo-Json -Depth 5
```

### Local API Health Check
```powershell
Invoke-RestMethod http://localhost:19080/api/cloud/health | ConvertTo-Json -Depth 5
```

---

## 2. Step-by-Step Demo Verification Script

### A. Cloud Admin Setup
1. **Open Cloud Frontend**: Navigate to your deployed cloud web dashboard or open `http://localhost:5173` locally.
2. **Admin Login**: Sign in using your administrator credentials.
3. **Verify Users Page**: Go to the **Users** tab. Confirm that you can see active instructors and trainees.
4. **Create / Inspect Users**:
   - Create or check an **Instructor** user.
   - Create or check a **Trainee** user.
5. **Set LocalHub Password**:
   - On the Users page, click **Set Hub PIN** or **Set LocalHub Password** for both the instructor and trainee. Set a simple password/PIN (e.g., `123456`).
6. **Create / Inspect Course**: Go to the **Courses** tab. Create a new course (e.g., `CPR-101`).
7. **Assign Instructor**: In the course editor/detail view, assign the newly created instructor to the course.
8. **Enroll Trainee**: Enroll the newly created trainee in the course.

### B. LocalHub Sync
1. **Start LocalHub**: Run the LocalHub desktop application.
2. **Verify Hub Info**: Open a browser or terminal to check if the LocalHub service info endpoint is up:
   ```powershell
   Invoke-RestMethod http://localhost:18080/api/hub/service-info | ConvertTo-Json -Depth 5
   ```
3. **Run Roster Sync**: On the LocalHub settings or admin panel, trigger the **Roster Pull/Sync**. This calls:
   ```text
   GET /api/sync/roster
   ```
   Confirm that the sync completes successfully.
4. **Confirm Synced Roster**: Verify that the newly assigned course, instructor, and trainee now appear in the LocalHub local database.
5. **Local Login**: On the LocalHub login screen, attempt to log in offline as the trainee or instructor using the PIN/password you set in the Cloud Admin panel. Confirm authentication succeeds.

### C. Training Session
1. **Connect Manikin**: Connect a physical resuscitation manikin to the LocalHub, or execute the no-hardware virtual manikin script.
2. **Check Device Status**: Confirm that the device shows online on the LocalHub dashboard and displays the state `READY_FOR_SESSION`.
3. **Start Session**: Click **Start Session** on the LocalHub interface.
4. **Telemetry Updates**: Perform compressions or generate virtual telemetry data. Confirm that live compression rate and depth are updated in real-time on the screen.
5. **End Session**: Click **Stop / End Session**.
6. **Confirm Summary**: Check that a local session summary is generated and can be viewed or exported locally.

### D. Cloud Sync & Verification
1. **Verify Sync Queue**: Navigate to the LocalHub Sync dashboard or check the pending upload queue:
   ```powershell
   Invoke-RestMethod http://localhost:18080/api/sync-queue | ConvertTo-Json -Depth 5
   ```
2. **No Auth Failures**: Confirm that the sync queue does not fail with HTTP `401 Unauthorized` or `403 Forbidden` status codes. The LocalHub must include the proper `X-ResQ-Hub-Id` and `X-ResQ-Hub-Key` headers automatically.
3. **Verify Upload**: Once the sync queue completes, verify that the session record status transitions to `SYNCED`.
4. **Open Cloud Reports**: Log back into the Cloud Frontend. Open the **Reports** page. Confirm the synced CPR training session is visible.
5. **Verify Trainee Personal Dashboard**: Log out of the cloud and log in as the **Trainee**. Open the `/me` dashboard. Confirm the trainee's personal best/latest CPR metrics and session log are displayed.
6. **Open Cloud Analytics**: Log back in as an **Admin** or **Instructor**. Open the **Analytics** page. Confirm that the synced session data is aggregated in the course/trainee charts.
7. **Export CSV**: On the Reports page, apply filters and click **Export CSV**. Verify the downloaded file opens correctly and displays the filtered data.

---

## 3. Sync Security Checks

Verify that the cloud API restricts session uploads and roster pulls to authorized hubs only.

### Expected Behavior
- `POST /api/sync/session-summaries` without hub headers → **401/403 Rejected**
- `POST /api/sync/session-summaries` with wrong hub key → **401/403 Rejected**
- `POST /api/sync/session-summaries` with valid hub headers → **200/201 Accepted**

### Security Testing Commands

#### Test 1: Request Without Hub Headers
```powershell
$headers = @{}
$body = '{"localSessionId":"test-123","cprScore":95.0}'
try {
    Invoke-RestMethod -Uri "https://<api-gateway-url>/api/sync/session-summaries" -Method Post -Headers $headers -Body $body -ContentType "application/json"
} catch {
    Write-Host "Rejected as expected: $_"
}
```

#### Test 2: Request With Invalid Hub Credentials
```powershell
$headers = @{
    "X-ResQ-Hub-Id" = "hub-001"
    "X-ResQ-Hub-Key" = "invalid-hub-key"
}
$body = '{"localSessionId":"test-123","cprScore":95.0}'
try {
    Invoke-RestMethod -Uri "https://<api-gateway-url>/api/sync/session-summaries" -Method Post -Headers $headers -Body $body -ContentType "application/json"
} catch {
    Write-Host "Rejected as expected: $_"
}
```

#### Test 3: Request With Valid Hub Credentials (Local Test)
```powershell
# Querying local cloud database seed
$headers = @{
    "X-ResQ-Hub-Id" = "<hub-id>"
    "X-ResQ-Hub-Key" = "<hub-key>"
}
$body = '{"localSessionId":"test-123","localHubId":"<hub-id>","cprScore":95.0,"startTime":"2026-06-14T12:00:00Z","endTime":"2026-06-14T12:02:00Z","avgRate":105.0,"avgDepth":52.0,"totalCompressions":210,"correctRateCount":190,"correctDepthCount":185,"ventilationCount":0,"correctVentilationCount":0}'
Invoke-RestMethod -Uri "http://localhost:19080/api/sync/session-summaries" -Method Post -Headers $headers -Body $body -ContentType "application/json"
```

---

## 4. LocalHub No-Hardware Smoke Commands

Verify LocalHub logic and API synchronization without physical manikin hardware.

### Online Smoke Test
Runs a full simulated CPR training session and uploads it to the configured cloud target:
```powershell
cd "D:\Semester 6\3YP\e21-3yp-ResQ\code\resq-localhub"
node scripts/no-hardware-smoke/run-smoke-test.mjs --topic-style short
```

### Offline / Queued Sync Smoke Test
Simulates an offline training session (saving to local SQLite queue) and verifies deferred sync once connectivity resumes:
```powershell
cd "D:\Semester 6\3YP\e21-3yp-ResQ\code\resq-localhub"
node scripts/no-hardware-smoke/run-smoke-test.mjs --topic-style short --test-offline
```

---

## 5. E2E Demo Status Checklist

Use the following checklist to mark items PASS/FAIL during the live demo:

| Item | Expected Result | PASS/FAIL | Notes |
| :--- | :--- | :---: | :--- |
| Cloud health | UP | | |
| Admin login | Success | | |
| Users page | Loads users | | |
| Set LocalHub PIN | Success message shown | | |
| Courses page | Course visible/editable | | |
| Instructor assignment | Correct instructor shown | | |
| Roster sync | Success | | |
| LocalHub trainee login | Success | | |
| Manikin online | READY_FOR_SESSION | | |
| Session start/end | Success | | |
| Session summary upload | SYNCED/no 401/403 | | |
| Cloud reports | New session visible | | |
| CSV export | File downloads | | |
| Trainee /me | Session visible | | |
| Analytics filters | Working | | |
| Sync security | Invalid requests rejected | | |
