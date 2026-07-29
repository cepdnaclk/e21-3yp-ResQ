# Phase 1 — Environment, Build, and Regression Baseline

## 1. Scope

Verified the installed toolchain, required paths, port availability, clean firmware builds, LocalHub backend regression suite/package, desktop typecheck/tests/build, simulator syntax, fixture JSON, and PowerShell validation-script syntax.

## 2. Baseline

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting commit: `c777ece`
- Ending commit: this report's containing commit
- Firmware version: base repository firmware built with ESP-IDF v6.0-dirty
- LocalHub version: `0.1.1`
- Device ID: not applicable
- Hardware or simulator: build-only; simulator syntax checked
- MQTT broker: Mosquitto 2.1.2, not started
- Backend URL: `http://127.0.0.1:18080`

## 3. Commands Executed

```powershell
Get-Command git,idf.py,mosquitto,mosquitto_sub,mosquitto_pub,java,node,pnpm.cmd
Get-NetTCPConnection -State Listen |
    Where-Object LocalPort -In 1883,18080,1420

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command {
    & "C:\Espressif\tools\Microsoft.v6.0.PowerShell_profile.ps1"
    idf.py --version

    Set-Location code\resq-firmware
    idf.py set-target esp32c3
    idf.py fullclean
    idf.py build
    idf.py size

    Set-Location test
    idf.py set-target esp32c3
    idf.py fullclean
    idf.py build
}

Set-Location code\resq-localhub\services\hub-api
.\mvnw.cmd clean test
.\mvnw.cmd package -DskipTests

Set-Location code\resq-localhub\apps\localhub-desktop
pnpm.cmd install --frozen-lockfile
pnpm.cmd typecheck
pnpm.cmd test -- --reporter=dot
pnpm.cmd build

Set-Location code\resq-localhub
node --check scripts\firmware-simulator\firmware-simulator.js
Get-Content -Raw docs\telemetry-api-update\fixtures\sensor-stream-contract-fixtures.json |
    ConvertFrom-Json |
    Out-Null
[System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path scripts\telemetry-e2e\validate-sensor-stream.ps1),
    [ref]$null,
    [ref]$null
)
```

## 4. Files Changed

| File | Change | Reason |
| ---- | ------ | ------ |
| `phase-01-environment.txt` | Added | Record tool versions, paths, port state, and ESP-IDF invocation constraint. |
| `phase-01-firmware-*.txt` | Added | Preserve production firmware configure, clean, build, and size evidence. |
| `phase-01-firmware-tests-*.txt` | Added | Preserve Unity test-app configure, clean, and build evidence. |
| `phase-01-backend-*.txt` | Added | Preserve backend regression and package output. |
| `phase-01-desktop-*.txt` | Added | Preserve dependency, typecheck, test, and production-build output. |
| `phase-01-simulator-syntax.txt` | Added | Record simulator JavaScript syntax validation. |
| `phase-01-fixture-parse.txt` | Added | Record successful JSON fixture parsing. |
| `phase-01-validation-script-parse.txt` | Added | Record PowerShell validation-script parsing. |
| `phase-01-report.md` | Added | Summarize Phase 1 results and findings. |

No firmware or LocalHub source file remains modified after the build tools' generated-file side effects were cleaned up.

## 5. Test Results

| Test | Expected | Actual | PASS/FAIL/BLOCKED |
| ---- | -------- | ------ | ----------------- |
| Required paths | All exist | All four required paths exist | PASS |
| Port preflight | 1883, 18080, 1420 available | No listeners found | PASS |
| Production firmware clean build | Successful ESP32-C3 image | `resq-firmware.bin` built; 1,161,108 bytes; 41% app partition free | PASS |
| Firmware test-app clean build | Successful ESP32-C3 Unity image | `resq_firmware_unity.bin` built; 413,520 bytes; 79% app partition free | PASS |
| Firmware Unity execution | Full suite passes on hardware | No COM port selected in Phase 1 | BLOCKED |
| Backend tests | No failures | 219 tests; 0 failures; 0 errors; 0 skipped | PASS |
| Backend package | Bootable JAR produced | `hub-api-0.1.1-SNAPSHOT.jar` produced | PASS |
| Desktop dependency state | Frozen lockfile accepted | Lockfile current; no install changes | PASS |
| Desktop typecheck | No TypeScript errors | Exit code 0 | PASS |
| Desktop tests | No failures | 22 files; 100 tests passed | PASS |
| Desktop production build | Vite build succeeds | 945 modules; built in 17.10 seconds | PASS |
| Simulator syntax | Valid JavaScript | `node --check` exit code 0 | PASS |
| Contract fixture JSON | Parses successfully | Parsed successfully | PASS |
| Validation script | Parses without errors | Parsed successfully | PASS |

## 6. Traffic Measurements

Not applicable. Phase 1 did not start the broker, backend, firmware, or simulator runtime.

## 7. Findings

| ID | Priority | Area | Finding | Evidence | Proposed action |
| -- | -------- | ---- | ------- | -------- | --------------- |
| P1-F01 | P2 | Desktop build | The main JavaScript bundle is 1,570.44 kB minified (431.04 kB gzip), and Vite reports a chunk-size warning. | `phase-01-desktop-build.txt` | Measure runtime performance during scaling; split bundles only if startup or memory evidence warrants it. |
| P1-F02 | P2 | Tooling | The ESP-IDF profile is installed but blocked by the host's default PowerShell execution policy. | `phase-01-environment.txt` | Keep using a process-scoped `-ExecutionPolicy Bypass` in verification commands; do not change the user's global policy. |
| P1-F03 | P2 | Firmware validation | The Unity application builds, but tests were not flashed or executed because no hardware COM port was selected. | `phase-01-firmware-tests-build.txt` | Complete execution in Phase 10 after detecting the real serial port. |

## 8. Regressions

None observed in the build and software regression suites.

## 9. Decisions Required

| Question | Options | Recommendation | Owner |
| -------- | ------- | -------------- | ----- |
| Should the desktop bundle be split now? | Split before runtime testing; defer until measurements | Defer until Phase 9 provides startup, CPU, and memory evidence. | LocalHub team |

## 10. Known Limitations

- Firmware Unity tests were built but not executed on hardware.
- No runtime MQTT, SSE, session, or recovery behavior was exercised in this phase.
- The desktop build warning is recorded but is not a build failure.

## 11. Acceptance Decision

- [ ] PASS
- [x] PASS WITH FOLLOW-UP
- [ ] FAIL
- [ ] BLOCKED

Reason: every build and host-executable regression passed. Hardware execution is intentionally deferred and the non-blocking desktop bundle warning is documented.

## 12. Commit

- Commit: this report's containing commit
- Message: `test(integration): record firmware and localhub baseline`
- Rollback point: `c777ece`
