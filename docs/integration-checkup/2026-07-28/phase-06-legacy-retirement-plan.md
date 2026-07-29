# Phase 6 legacy compatibility retirement plan

## Compatibility retained in Phase 6

LocalHub continues to accept the legacy `resq/manikins/{deviceId}/...` topic
namespace, unordered state messages, camel-case identity/ordering aliases, the
telemetry `state` discriminator, and `pressure_balance_pct`. All forms normalize
into the canonical device and metric models; LocalHub command publication remains
canonical-only.

Three ingestion counters make the remaining compatibility traffic measurable:

| Counter | Meaning |
| --- | --- |
| `legacyTopicMessageCount` | Accepted or rejected messages received on `resq/manikins/{deviceId}/...` |
| `legacyPayloadAliasCount` | Messages containing at least one deprecated payload alias |
| `unorderedLegacyMessageCount` | State-bearing messages without both `boot_id` and `state_seq` |

The counters are internal diagnostics and are not included in ordinary dashboard
REST or SSE DTOs.

## Retirement gates

Legacy support may be removed only after all of these are true:

1. All physical manikins used in deployment and rollback testing run firmware
   that publishes canonical topics, `telemetry_mode`, canonical pressure score,
   and boot-aware state ordering.
2. The three compatibility counters remain at zero for an agreed soak period
   that includes idle, calibration, sensor-stream, active-session, restart, and
   recovery scenarios.
3. Source and contract tests show no backend or frontend dependency on deprecated
   aliases.
4. Hardware validation is complete for every supported manikin revision.
5. A tested rollback firmware image and its compatibility contract are archived.

Removing aliases is a later compatibility-window decision. Phase 6 does not
remove inbound support or change production firmware.

## Liveness policy

Every identity-validated firmware message may refresh transport receipt time.
Rejected identity or schema traffic never reaches the registry and therefore
cannot refresh liveness. Firmware `ts_ms` and `uptime_ms` remain diagnostic
monotonic values and never determine wall-clock liveness.

With defaults, a device is current through 12 seconds after the last accepted
message, stale after 12 seconds, and offline after 22 seconds. This tolerates one
missed five-second heartbeat without a state transition and separates the stale
warning window from the offline policy.
