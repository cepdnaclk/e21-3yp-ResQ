# Phase 0 — Protect the Git Baseline

## 1. Scope

Established an isolated firmware–LocalHub integration verification branch and recorded the repository state before integration-checkup changes.

## 2. Baseline

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting commit: `f7aa2890c45c5d380d6283193083dec006349b6a`
- Ending commit: this report's containing commit
- Firmware version: repository state at the base commit
- LocalHub version: repository state at the base commit
- Device ID: not applicable
- Hardware or simulator: not applicable
- MQTT broker: not started
- Backend URL: `http://127.0.0.1:18080`

## 3. Commands Executed

```powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short --untracked-files=all
git log -10 --oneline
git switch -c integration/firmware-localhub-traffic-scaling
```

## 4. Files Changed

| File | Change | Reason |
| ---- | ------ | ------ |
| `BASE_COMMIT.txt` | Added | Preserve the rollback point for all later phases. |
| `phase-00-git-baseline.txt` | Added | Record repository, branch, and base commit. |
| `phase-00-git-status.txt` | Added | Record that the pre-phase worktree was clean. |
| `phase-00-recent-commits.txt` | Added | Preserve recent history used to establish context. |
| `phase-00-report.md` | Added | Record Phase 0 evidence and acceptance decision. |

## 5. Test Results

| Test | Expected | Actual | PASS/FAIL/BLOCKED |
| ---- | -------- | ------ | ----------------- |
| Repository root | ResQ repository root | `D:/Academics/SEM6/3YP/e21-3yp-ResQ` | PASS |
| Starting worktree | No unrelated changes | Clean | PASS |
| Integration branch | Dedicated branch at base commit | Created at `f7aa289` | PASS |
| Rollback point | Exact full commit ID saved | Saved in `BASE_COMMIT.txt` | PASS |

## 6. Traffic Measurements

Not applicable in Phase 0.

## 7. Findings

| ID | Priority | Area | Finding | Evidence | Proposed action |
| -- | -------- | ---- | ------- | -------- | --------------- |
| P0-F01 | P2 | Git | The source branch was four commits ahead of `origin/resq-firmware`, while its HEAD matched the merged repository state. | Initial `git status --branch` and recent log | Use the recorded full commit as the immutable baseline; do not pull or rewrite history during verification. |

## 8. Regressions

None. Phase 0 changed no firmware or LocalHub runtime code.

## 9. Decisions Required

None.

## 10. Known Limitations

Remote branches were not fetched; the baseline intentionally uses the clean local HEAD supplied for this continuation.

## 11. Acceptance Decision

- [x] PASS
- [ ] PASS WITH FOLLOW-UP
- [ ] FAIL
- [ ] BLOCKED

Reason: the dedicated branch exists at the recorded clean base commit and no runtime code was changed.

## 12. Commit

- Commit: this report's containing commit
- Message: `docs(integration): initialize firmware-localhub verification records`
- Rollback point: `f7aa2890c45c5d380d6283193083dec006349b6a`
