#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "sensor_runtime.h"

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================
 * Canonical topic suffixes
 * ========================================================= */
#define RESQ_SUFFIX_STATUS                "status"
#define RESQ_SUFFIX_HEARTBEAT             "heartbeat"
#define RESQ_SUFFIX_TELEMETRY             "telemetry"
#define RESQ_SUFFIX_EVENTS                "events"

#define RESQ_SUFFIX_CMD_SESSION_START     "cmd/session/start"
#define RESQ_SUFFIX_CMD_SESSION_STOP      "cmd/session/stop"
#define RESQ_SUFFIX_CMD_DIAG_PING         "cmd/diag/ping"
#define RESQ_SUFFIX_CMD_DIAG_REQUEST      "cmd/diag/request"
#define RESQ_SUFFIX_CMD_DEVICE_RESET      "cmd/device/reset"
#define RESQ_SUFFIX_CMD_DEVICE_UNPAIR     "cmd/device/unpair"
#define RESQ_SUFFIX_CMD_CONFIG_UPDATE     "cmd/config/update"

/* =========================================================
 * Topic helpers
 * ========================================================= */
size_t resq_topic_build(char *out, size_t out_len, const char *device_id, const char *suffix);

/* =========================================================
 * Payload builders
 * Returned string must be freed with cJSON_free()
 * ========================================================= */
char *resq_payload_status(
    const char *device_id,
    const char *state,
    bool session_active,
    const char *session_id
);

char *resq_payload_heartbeat(
    const char *device_id,
    const char *manikin_id,
    bool wifi_connected,
    bool mqtt_connected,
    bool session_active,
    bool sensor_running,
    const char *session_id,
    const char *ip,
    bool force1_ok,
    bool force2_ok,
    bool hall_ok,
    int compression_count
);

char *resq_payload_telemetry(
    const char *device_id,
    const char *manikin_id,
    const char *session_id,
    const sensor_snapshot_t *snap
);

char *resq_payload_feedback_event(
    const char *device_id,
    const char *session_id,
    const sensor_snapshot_t *snap
);

char *resq_payload_fault_event(
    const char *device_id,
    const char *session_id,
    const char *fault_code,
    const char *message,
    bool active
);

char *resq_payload_command_result(
    const char *device_id,
    const char *session_id,
    const char *command,
    const char *status,
    const char *reason
);

#ifdef __cplusplus
}
#endif