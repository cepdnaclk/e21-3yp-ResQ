#include "resq_protocol.h"

#include <stdio.h>
#include <string.h>


#include "cJSON.h"

static const char *safe_str(const char *s)
{
    return (s != NULL) ? s : "";
}

char *resq_payload_status(
    const char *device_id,
    const char *state,
    bool session_active,
    const char *session_id
)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "state", safe_str(state));
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

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
)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "manikin_id", safe_str(manikin_id));
    cJSON_AddBoolToObject(root, "wifi_connected", wifi_connected);
    cJSON_AddBoolToObject(root, "mqtt_connected", mqtt_connected);
    cJSON_AddBoolToObject(root, "session_active", session_active);
    cJSON_AddBoolToObject(root, "sensor_running", sensor_running);
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));
    cJSON_AddStringToObject(root, "ip", safe_str(ip));

    cJSON_AddBoolToObject(root, "force1_ok", force1_ok);
    cJSON_AddBoolToObject(root, "force2_ok", force2_ok);
    cJSON_AddBoolToObject(root, "hall_ok", hall_ok);
    cJSON_AddNumberToObject(root, "compression_count", compression_count);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

char *resq_payload_telemetry(
    const char *device_id,
    const char *manikin_id,
    const char *session_id,
    const sensor_snapshot_t *snap
)
{
    if (snap == NULL) {
        return NULL;
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "manikin_id", safe_str(manikin_id));
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));

    cJSON_AddNumberToObject(root, "force1", snap->force1);
    cJSON_AddNumberToObject(root, "force2", snap->force2);
    cJSON_AddBoolToObject(root, "force1_ok", snap->force1_ok);
    cJSON_AddBoolToObject(root, "force2_ok", snap->force2_ok);

    cJSON_AddBoolToObject(root, "hall_ok", snap->hall_ok);
    cJSON_AddNumberToObject(root, "hall_raw", snap->hall_raw);
    cJSON_AddNumberToObject(root, "current_delta", snap->current_delta);

    cJSON_AddNumberToObject(root, "total_compressions", snap->total_compressions);
    cJSON_AddStringToObject(root, "feedback", cpr_feedback_to_string(snap->feedback));

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

char *resq_payload_feedback_event(
    const char *device_id,
    const char *session_id,
    const sensor_snapshot_t *snap
)
{
    if (snap == NULL) {
        return NULL;
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));
    cJSON_AddStringToObject(root, "event_type", "compression_feedback");
    cJSON_AddNumberToObject(root, "compression_count", snap->total_compressions);
    cJSON_AddStringToObject(root, "feedback", cpr_feedback_to_string(snap->feedback));
    cJSON_AddNumberToObject(root, "current_delta", snap->current_delta);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

char *resq_payload_fault_event(
    const char *device_id,
    const char *session_id,
    const char *fault_code,
    const char *message,
    bool active
)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));
    cJSON_AddStringToObject(root, "event_type", "fault");
    cJSON_AddStringToObject(root, "fault_code", safe_str(fault_code));
    cJSON_AddStringToObject(root, "message", safe_str(message));
    cJSON_AddBoolToObject(root, "active", active);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

char *resq_payload_command_result(
    const char *device_id,
    const char *session_id,
    const char *command,
    const char *status,
    const char *reason
)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "session_id", safe_str(session_id));
    cJSON_AddStringToObject(root, "event_type", "command_result");
    cJSON_AddStringToObject(root, "command", safe_str(command));
    cJSON_AddStringToObject(root, "status", safe_str(status));
    cJSON_AddStringToObject(root, "reason", safe_str(reason));

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

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
)
{
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    cJSON_AddStringToObject(root, "event_type", safe_str(event_type));
    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "manikin_id", safe_str(manikin_id));
    cJSON_AddStringToObject(root, "firmware_version", safe_str(firmware_version));
    cJSON_AddStringToObject(root, "hardware_revision", safe_str(hardware_revision));
    cJSON_AddStringToObject(root, "build_date", safe_str(build_date));
    cJSON_AddStringToObject(root, "build_time", safe_str(build_time));
    cJSON_AddStringToObject(root, "chip_model", safe_str(chip_model));
    cJSON_AddNumberToObject(root, "chip_cores", chip_cores);
    cJSON_AddNumberToObject(root, "chip_revision", chip_revision);
    cJSON_AddStringToObject(root, "mac_address", safe_str(mac_address));
    cJSON_AddNumberToObject(root, "reset_reason", reset_reason);

    char *payload = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return payload;
}

esp_err_t resq_build_topic(
    const char *device_id,
    const char *suffix,
    char *out,
    size_t out_len
) {
    if (!device_id || !suffix || !out || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int written = snprintf(
        out,
        out_len,
        "resq/manikins/%s/%s",
        device_id,
        suffix
    );

    if (written < 0 || written >= (int)out_len) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}

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
    char *out,
    size_t out_len
) {
    if (!device_id || !manikin_id || !session_id || !out || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * IMPORTANT:
     * debugRaw is intentionally NOT included here yet.
     * Add it later only when debug_raw_enabled is true and raw values are passed in.
     */
    int written = snprintf(
        out,
        out_len,
        "{"
            "\"deviceId\":\"%s\","
            "\"manikinId\":\"%s\","
            "\"sessionId\":\"%s\","
            "\"tsMs\":%llu,"
            "\"depthMm\":%.1f,"
            "\"rateCpm\":%.1f,"
            "\"recoilOk\":%s,"
            "\"pauseS\":%.2f,"
            "\"compressionCount\":%d,"
            "\"handPlacement\":\"%s\","
            "\"flags\":%s"
        "}",
        device_id,
        manikin_id,
        session_id,
        (unsigned long long)ts_ms,
        depth_mm,
        rate_cpm,
        recoil_ok ? "true" : "false",
        pause_s,
        compression_count,
        hand_placement ? hand_placement : "UNKNOWN",
        flags_json ? flags_json : "[]"
    );

    if (written < 0 || written >= (int)out_len) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}

esp_err_t resq_payload_calibration_report(
    const char *device_id,
    const char *profile_id,
    const char *result,
    bool ready_for_session,
    char *out,
    size_t out_len
) {
    if (!device_id || !profile_id || !result || !out || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int written = snprintf(
        out,
        out_len,
        "{"
            "\"event_type\":\"calibration_report\","
            "\"device_id\":\"%s\","
            "\"profileId\":\"%s\","
            "\"result\":\"%s\","
            "\"readyForSession\":%s"
        "}",
        device_id,
        profile_id,
        result,
        ready_for_session ? "true" : "false"
    );

    if (written < 0 || written >= (int)out_len) {
        return ESP_ERR_NO_MEM;
    }

    return ESP_OK;
}
