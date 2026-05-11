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
)
{
    /*
     * Heartbeat is intentionally minimal to reduce background traffic.
     * Keep the function signature for compatibility but only return a
     * small liveness object. Optionally include a state string if the
     * caller provided a sensor_mode string.
     */
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return NULL;
    }

    /* Preferred minimal payload: { "alive": true } */
    cJSON_AddBoolToObject(root, "alive", true);

    /* Slightly richer payload allowed: include state if provided */
    if (sensor_mode != NULL && sensor_mode[0] != '\0') {
        cJSON_AddStringToObject(root, "state", safe_str(sensor_mode));
    }

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
    cJSON_AddNumberToObject(root, "depthMm", snap->depth_mm);
    cJSON_AddNumberToObject(root, "rateCpm", snap->rate_cpm);
    cJSON_AddBoolToObject(root, "recoilOk", snap->recoil_ok);

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
    cJSON_AddStringToObject(root, "event_type", active ? "fault" : "fault_recovered");
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
) {
    if (!device_id || !session_id || !out || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int written = snprintf(
        out,
        out_len,
        "{"
            "\"deviceId\":\"%s\","
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

    if (debug_raw_enabled && debug_snap != NULL) {
        int used = written;
        int extra = snprintf(
            out + used - 1,
            out_len - (size_t)used + 1,
            ",\"debugRaw\":{"
                "\"force1\":%ld,"
                "\"force2\":%ld,"
                "\"hallRaw\":%ld,"
                "\"hallFiltered\":%ld,"
                "\"currentDelta\":%ld"
            "}}",
            (long)debug_snap->force1,
            (long)debug_snap->force2,
            (long)debug_snap->hall_raw,
            (long)debug_snap->hall_filtered,
            (long)debug_snap->current_delta
        );

        if (extra < 0 || extra >= (int)(out_len - (size_t)used + 1)) {
            return ESP_ERR_NO_MEM;
        }
    }

    return ESP_OK;
}

esp_err_t resq_payload_calibration_report(
    const char *device_id,
    const calibration_report_t *report,
    char *out,
    size_t out_len
) {
    if (!device_id || !report || !out || out_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "event_type", "calibration_report");
    cJSON_AddStringToObject(root, "device_id", safe_str(device_id));
    cJSON_AddStringToObject(root, "profileId", safe_str(report->profile_id));
    cJSON_AddStringToObject(root, "result", calibration_manager_result_to_string(report->result));
    cJSON_AddBoolToObject(root, "readyForSession", report->ready_for_session);

    cJSON *normal = cJSON_AddObjectToObject(root, "normalPosition");
    if (normal != NULL) {
        cJSON_AddNumberToObject(normal, "hallBaselineExpected", report->normal.hall_baseline_expected);
        cJSON_AddNumberToObject(normal, "hallBaselineActual", report->normal.hall_baseline_actual);
        cJSON_AddNumberToObject(normal, "hallNoise", report->normal.hall_noise);
        cJSON_AddBoolToObject(normal, "pass", report->normal.pass);
    }

    cJSON *base = cJSON_AddObjectToObject(root, "baseReferencePressure");
    if (base != NULL) {
        cJSON_AddNumberToObject(base, "force1Expected", report->pressure.force1_expected);
        cJSON_AddNumberToObject(base, "force1Actual", report->pressure.force1_actual);
        cJSON_AddNumberToObject(base, "force2Expected", report->pressure.force2_expected);
        cJSON_AddNumberToObject(base, "force2Actual", report->pressure.force2_actual);
        cJSON_AddNumberToObject(base, "imbalancePct", report->pressure.imbalance_pct);
        cJSON_AddBoolToObject(base, "pass", report->pressure.pass);
    }

    cJSON *full = cJSON_AddObjectToObject(root, "fullCompressionDepth");
    if (full != NULL) {
        cJSON_AddNumberToObject(full, "targetDepthMm", report->depth.target_depth_mm);
        cJSON_AddNumberToObject(full, "peakHallDelta", report->depth.peak_hall_delta);
        cJSON_AddNumberToObject(full, "estimatedDepthMm", report->depth.estimated_depth_mm);
        cJSON_AddBoolToObject(full, "pass", report->depth.pass);
    }

    cJSON *recoil = cJSON_AddObjectToObject(root, "recoil");
    if (recoil != NULL) {
        cJSON_AddNumberToObject(recoil, "returnDepthMm", report->recoil.return_depth_mm);
        cJSON_AddNumberToObject(recoil, "returnDelta", report->recoil.return_delta);
        cJSON_AddBoolToObject(recoil, "pass", report->recoil.pass);
    }

    cJSON *faults = cJSON_AddArrayToObject(root, "faults");
    cJSON *warnings = cJSON_AddArrayToObject(root, "warnings");

    if (!report->normal.pass) {
        cJSON_AddItemToArray(faults, cJSON_CreateString("normal_position_failed"));
    }

    if (!report->pressure.pass) {
        char buf[128];
        snprintf(buf, sizeof(buf), "pressure_check_failed (imbalance=%.1f)", report->pressure.imbalance_pct);
        cJSON_AddItemToArray(faults, cJSON_CreateString(buf));
    }

    if (!report->depth.pass) {
        cJSON_AddItemToArray(faults, cJSON_CreateString("depth_check_failed"));
    }

    if (!report->recoil.pass) {
        cJSON_AddItemToArray(faults, cJSON_CreateString("recoil_check_failed"));
    }

    if (report->pressure.force1_expected == 0 && report->pressure.force2_expected == 0) {
        cJSON_AddItemToArray(warnings, cJSON_CreateString("base_force_reference_missing"));
    }

    if (!report->normal_captured) {
        cJSON_AddItemToArray(warnings, cJSON_CreateString("normal_capture_missing"));
    }

    if (!report->full_depth_captured) {
        cJSON_AddItemToArray(warnings, cJSON_CreateString("full_depth_capture_missing"));
    }

    char *s = cJSON_PrintUnformatted(root);
    if (s == NULL) {
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }

    if ((size_t)strlen(s) >= out_len) {
        cJSON_free(s);
        cJSON_Delete(root);
        return ESP_ERR_NO_MEM;
    }

    strncpy(out, s, out_len - 1);
    out[out_len - 1] = '\0';
    cJSON_free(s);
    cJSON_Delete(root);
    return ESP_OK;
}
