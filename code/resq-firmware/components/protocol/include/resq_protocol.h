#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
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

#define RESQ_STATE_OFFLINE              "OFFLINE"
#define RESQ_STATE_ONLINE_IDLE          "IDLE"
#define RESQ_STATE_CALIBRATING          "CALIBRATING"
#define RESQ_STATE_READY_FOR_SESSION    "READY_FOR_SESSION"
#define RESQ_STATE_CALIBRATION_FAIL     "CALIBRATION_FAIL"
#define RESQ_STATE_SESSION_ACTIVE       "SESSION_ACTIVE"
#define RESQ_STATE_SESSION_INTERRUPTED  "SESSION_INTERRUPTED"
#define RESQ_STATE_FAULT                "FAULT"
#define RESQ_STATE_RESETTING            "RESETTING"

#define RESQ_SUFFIX_CMD_SESSION_START     "cmd/session/start"
#define RESQ_SUFFIX_CMD_SESSION_STOP      "cmd/session/stop"
#define RESQ_SUFFIX_CMD_DIAG_PING         "cmd/diag/ping"
#define RESQ_SUFFIX_CMD_DIAG_REQUEST      "cmd/diag/request"
#define RESQ_SUFFIX_CMD_DEVICE_RESET      "cmd/device/reset"
#define RESQ_SUFFIX_CMD_DEVICE_UNPAIR     "cmd/device/unpair"
#define RESQ_SUFFIX_CMD_CONFIG_UPDATE     "cmd/config/update"

// New calibration command suffixes
#define RESQ_SUFFIX_CMD_CALIBRATION_START           "cmd/calibration/start"
#define RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_NORMAL  "cmd/calibration/capture-normal"
#define RESQ_SUFFIX_CMD_CALIBRATION_CAPTURE_DEPTH   "cmd/calibration/capture-full-depth"
#define RESQ_SUFFIX_CMD_CALIBRATION_VALIDATE        "cmd/calibration/validate"
#define RESQ_SUFFIX_CMD_CALIBRATION_CANCEL          "cmd/calibration/cancel"

// Optional future debug command
#define RESQ_SUFFIX_CMD_DEBUG_TELEMETRY             "cmd/debug/telemetry"

/* =========================================================
 * Topic helpers
 * ========================================================= */
esp_err_t resq_build_topic(
    const char *device_id,
    const char *suffix,
    char *out,
    size_t out_len
);
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
    int compression_count,
    bool calibration_ready,
    const char *calibration_state,
    const char *profile_id,
    const char *last_calibration_result,
    bool debug_raw_enabled,
    const char *sensor_mode
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

char *resq_payload_identity_event(
    const char *event_type,
    const char *device_id,
    const char *manikin_id,
    const char *firmware_version,
    const char *hardware_revision,
    const char *build_date,
    const char *build_time,
    const char *chip_model,
    int chip_cores,
    int chip_revision,
    const char *mac_address,
    int reset_reason
);

esp_err_t resq_payload_calibration_report(
    const char *device_id,
    const char *profile_id,
    const char *result,
    bool ready_for_session,
    char *out,
    size_t out_len
);

esp_err_t resq_payload_metric_telemetry(
    const char *device_id,
    const char *manikin_id,
    const char *session_id,
    uint64_t ts_ms,
    float depth_mm,
    float rate_cpm,
    bool recoil_ok,
    float pause_s,
    int compression_count,
    const char *hand_placement,
    const char *flags_json,
    bool debug_raw_enabled,
    const sensor_snapshot_t *debug_snap,
    char *out,
    size_t out_len
);

#ifdef __cplusplus
}
#endif
