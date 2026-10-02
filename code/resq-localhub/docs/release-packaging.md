# Windows Local Hub release procedure

Run from code/resq-localhub/apps/localhub-desktop with Node, pnpm, a compatible
Windows Rust/MSVC toolchain and JDK 17 available on the build machine. The installed
application uses the bundled runtime and does not require a machine Java install.

```powershell
pnpm install --frozen-lockfile
pnpm test -- --maxWorkers=2
pnpm typecheck
Push-Location ../../services/hub-api
.\mvnw.cmd test
Pop-Location
Push-Location src-tauri
cargo test
Pop-Location
pnpm tauri:build
```

Do not run Maven tests concurrently with release preparation: preparation runs
`clean package`, which replaces target/. Do not package a manually copied old JAR.
The normal Tauri beforeBuildCommand runs tools/prepare-release.mjs, which checks
the broker distribution, runs Maven clean package including tests, stages and verifies
the JAR SHA256, runs scripts/release/prepare-release.ps1 to generate Java, and
builds/copies the Vite assets. It then runs the runtime smoke test before Rust and
installer compilation. Java's legal notices remain
in the runtime. The jlink script deliberately retains all JDK modules for reflection,
TLS and JNI compatibility. The builder needs jlink, not just a JRE.

The release script directory must remain unignored. Previously scripts/* excluded
the required Java preparation script from Git. Generated resources are not source
changes: review the diff and exclude rebuilt JAR/dashboard/runtime binaries from commits.
The generated backend JAR is no longer tracked in Git. Do not restore an old JAR
from Git after staging; keep the freshly verified artifact in the resources directory.

To run service verification independently (with Java/Mosquitto already staged):

```powershell
node ../../scripts/release/smoke-runtime.mjs
```

This command clean-builds/tests the backend and stages it before starting services.
Release preparation uses `--staged` immediately after its own clean build; this mode
rejects missing JARs or a staged SHA256 different from the Maven output before any
service starts. It is not a source freshness check; use the default command after
source changes. Status remains available at `/api/sync/cloud/status` with cloud sync
disabled. A 404 from an old artifact is a packaging failure, not a reason to skip it.

## Configuration and storage

Immutable installed resources: hub-api/resq-hub-api.jar, config/application-release.properties,
jre/, mosquitto/ and web-dashboard/. Tauri resolves these through resource_dir.
The release properties supplement classpath application.yml via
spring.config.additional-location; never change that to spring.config.location.

Mutable paths preserve the existing layout to avoid losing installed user data:

- `%USERPROFILE%\.resq-localhub\hub-api.sqlite`: local sessions, auth, roster and sync_queue.
- `%USERPROFILE%\.resq-localhub\cloud-sync.env`: optional private configuration.
- Tauri app-local-data directory (`%LOCALAPPDATA%\resq.ce.pdn.ac.lk` on Windows):
  managed broker runtime, PID metadata and logs/hub-api.log plus logs/mosquitto.log.
  The existing diagnostics API/UI exposes log paths.

Copy apps/localhub-desktop/cloud-sync.env.example to the private configuration path
and fill the registered hub identity/key there. Process environment overrides file
values. Missing credentials leave sync unconfigured; local training remains usable.
No development .env file is required after installation.

Public configuration: cloud base URLs, hub identifier, enabled switches and timing.
Secret configuration: hub keys. User bearer tokens remain in the existing auth token
store; they are never placed in SSE URLs. Never put keys/tokens in VITE_ variables,
Tauri configuration, resources, source or logs. Any previously embedded development
key should be rotated by its owner; no remote credential was changed by this repair.

The desktop preserves its existing public API Gateway endpoint through Rust defaults.
Standalone Spring retains its existing endpoint. Set both cloud/roster base URLs
explicitly when deploying to another environment; no new endpoint was invented.
The browser never contacts the cloud directly. Cloud uploads run in Spring.

Desktop URL is http://127.0.0.1:18080. LAN dashboard URLs use the selected LAN address
on port 1420; Spring still binds 0.0.0.0 and the broker retains 1883/9001. The desktop
CSP permits local service ports only; custom port deployments require coordinated
frontend/Rust/CSP configuration. Do not set HUB_API_PORT alone for installed builds.

Restrict any required Windows Firewall inbound rule to the installed Java/Mosquitto/
desktop executable, the private network profile and local subnet. Test from a second
device; do not disable the firewall or add unrestricted public-network rules.

## Mandatory installed acceptance and publication

Windows Application Control currently blocks Rust build helpers with error 4551.
Use an organization-approved build host or have the policy owner permit the normal
toolchain. No installer exists from this run. Once a build succeeds, install its
NSIS/MSI from src-tauri/target/release/bundle and launch from the installation path.
Do not count staged resource smoke tests or tauri dev as installed acceptance.

Verify UI version and service diagnostics; REST; both authenticated SSE streams;
reconnect after API restart; MQTT TCP/WS; pairing/calibration/start/telemetry/stop/
summary/reopen/export; durable cloud upload with valid private credentials; offline
training and queued retry after connectivity returns; restart persistence; second-device
LAN access. Check the actual WebView origin and CSP/network console in that build.

Only after acceptance, bump package.json, tauri.conf.json, Cargo.toml/Cargo.lock and
app-facing metadata consistently, update release notes, rebuild and retest the exact
final installer. Backend Maven has its own existing 0.1.1-SNAPSHOT version; do not
silently conflate that with the desktop version.

Existing tags include V.1.2.0 and V1.1.0. Never reuse an existing tag. After choosing
the next approved version and verifying its installer, publication can use:

```powershell
gh auth refresh -h github.com
git push -u origin fix/localhub-production-release
# Replace these only with the verified final version and actual installer path.
$releaseTag = 'V.<verified-version>'
$installer = '<absolute-path-to-verified-installer.exe>'
git tag $releaseTag
git push origin $releaseTag
gh release create $releaseTag $installer --verify-tag --title "ResQ Local Hub $releaseTag" --notes-file "docs/release-notes-<verified-version>.md"
```

The command intentionally has placeholders: no new version or installer is approved
by this incomplete installed-acceptance run. Reconfirm the repository's release
convention before publishing; GitHub authentication was invalid during this work.
