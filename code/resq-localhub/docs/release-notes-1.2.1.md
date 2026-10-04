# Local Hub 1.2.1 release 

## Fixes

- Follow-up: eliminated the tracked stale backend JAR that caused cloud status 404.
  Standalone smoke now clean-builds/tests and stages the backend. Release preparation
  verifies the copied JAR hash and runs smoke before installer compilation. The
  cloud-disabled status assertion remains mandatory.

- Dashboard/manikin, session and calibration SSE now use the existing bearer
  token via fetch streaming. The previous native EventSource relied on a
  SameSite=Lax cookie across the Tauri asset origin and loopback API.
- The shared stream reconnects after HTTP errors and EOF, uses bounded backoff,
  handles split CRLF frames, validates content type and cancels old subscriptions.
  Authentication failures stop retrying and session views show a useful error.
- Packaged Spring configuration now overlays the JAR configuration rather than
  replacing it. This preserves cloud/roster environment-variable bindings.
- Transient upload failures remain durable and retry automatically, even after
  the permanent-error retry limit. Backoff doubles from 30 seconds to 15 minutes.
- Cloud configuration accepts upload credentials and tuning options from the
  existing private cloud-sync.env. Embedded development credentials and command
  environment logging were removed. No credentials are included in the installer.
- The existing sync dashboard now shows configuration, durable pending count,
  last upload success, last attempt and upload error. Manual retry remains available.
- Restored the missing Java runtime preparation script. Release preparation builds
  a fresh JAR, validates broker files, creates a self-contained jlink runtime and
  rebuilds the desktop/LAN assets. MQTT TCP and WebSocket listeners remain enabled.
- Desktop REST/SSE stays on loopback despite stale build-time URL overrides.
  Packaged CSP is restricted to local API, MQTT and Tauri IPC endpoints.

## Verification and remaining acceptance

- Maven clean package: 395 tests passed.
- Frontend: 225 tests passed; TypeScript/Vite production build passed.
- Rust: cargo test --release passed all 13 tests. The earlier Windows policy
  failure did not recur in the later successful Rust release build.
- Stale staged-JAR rejection tested; current Maven/staged SHA256 verified equal.
- NSIS installer generated: ResQ Local Hub_1.2.1_x64-setup.exe (70,438,208 bytes).
- Installed using NSIS (exit 0) at D:\ResQ Local Hub. Installed JAR SHA256:
  54A960018EBA503A669D77B47986AFD59E424035C9B7918C6C920DF48A9E75AF.
- Actual installed WebView origin observed: http://tauri.localhost/.
- Installed UI displayed the configuration wizard using an isolated test database.
- Installed service orchestration started bundled Java, Mosquitto, API and dashboard.
- Installed health, bearer authentication, disabled-cloud status (HTTP 200), both
  SSE routes/content type/heartbeats/CORS, MQTT TCP/WS publish-subscribe and dashboard
  HTTP checks passed. API checks were performed outside WebView; authenticated
  dashboard interactions and CSP enforcement are not fully validated by these checks.
- Closing the app stopped its services and released ports, using the existing
  forced-termination fallback after the graceful timeout.
- Relaunching the installed app restarted services; the isolated account could
  authenticate again, cloud status remained available, and the WebView displayed
  "Connected to LocalHub". No test credentials were added to the normal database.

Cloud uploads were disabled for installed testing; real-cloud credentials and uploads,
network loss/recovery, actual firmware CPR workflow and second-device LAN access remain
unverified. The normal user database and credentials were not modified. Mock-cloud
retry/recovery and persistence are covered by the backend tests.

MSI packaging failed while invoking WiX light.exe; the NSIS installer is available.
GitHub CLI authentication was invalid, so no tag or release was created. Version 1.2.1
was already committed in cb90031 when final installed testing began.
