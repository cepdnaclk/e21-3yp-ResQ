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

## Verification and release blockers

Baseline build failed because scripts/release/prepare-release.ps1 was absent.
Baseline frontend suite had four failures; the deterministic failure was a stale
50 ms sensor expectation, corrected to the existing 100 ms contract. Baseline Java
tests accessed the real home database; Maven tests now use target/test-home.

The corrected build produced the JAR, bundled Java 17 runtime and Vite assets.
Rust tests and the Windows production build fail with Windows Application Control
error 4551 when executing a serde build helper. No policy bypass was attempted.

Staged runtime checks passed for MQTT TCP/WebSocket publish/subscribe, authenticated
REST, Tauri-origin CORS response, manikin/session SSE content type and heartbeats,
unauthorized rejection, and backend restart with persisted authentication/database.
These checks use isolated ports and data; they do not validate the installer,
WebView CSP enforcement, actual firmware, or another LAN device.

Cloud tests cover persistence, backoff, transient failure beyond the retry limit,
recovery and successful mock uploads. The real cloud service was not exercised.
No network-disable test of the installed app was possible.

Final automated results: 225 frontend tests across 46 files passed; Maven package
passed with 395 tests; TypeScript/Vite production build passed. Rust execution is
unverified because of the policy block. Repository-wide rustfmt also finds existing
formatting differences in commands.rs; only the modified API service was formatted.

Installer filename/path: none generated. Git tag/release: none created.
The GitHub CLI credential was invalid. See release-packaging.md for remaining gates.
