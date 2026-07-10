#include "telemetry_publisher.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_timer.h"

#include "mqtt_manager.h"
#include "session_manager.h"
#include "cpr_metrics.h"
#include "runtime_helpers.h"
#include "board_config.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "sensor_conversion.h"

static TaskHandle_t s_task = NULL;
static TaskHandle_t s_sensor_stream_task = NULL;
static SemaphoreHandle_t s_mutex = NULL;
static EventGroupHandle_t s_task_events = NULL;
static volatile bool s_running = false;
static volatile bool s_sensor_stream_running = false;
static uint32_t s_sensor_stream_interval_ms = 200;
static resq_state_t s_sensor_stream_state = RESQ_STATE_PAIRED_IDLE;
static calibration_config_t s_sensor_stream_calibration;

#define TELEMETRY_TASK_STARTED_BIT BIT0
#define TELEMETRY_TASK_STOPPED_BIT BIT1
#define SENSOR_STREAM_TASK_STARTED_BIT BIT2
#define SENSOR_STREAM_TASK_STOPPED_BIT BIT3
#define TELEMETRY_TASK_START_TIMEOUT_MS 1000
#define TELEMETRY_TASK_STOP_TIMEOUT_MS 1500
#define SENSOR_STREAM_TASK_START_TIMEOUT_MS 1000
#define SENSOR_STREAM_TASK_STOP_TIMEOUT_MS 1500
#define SENSOR_STREAM_DEFAULT_INTERVAL_MS 200
#define SENSOR_STREAM_MIN_INTERVAL_MS 50
#define SENSOR_STREAM_MAX_INTERVAL_MS 1000
#define SENSOR_STREAM_EVENT_ID 6100
#define SENSOR_STREAM_INVALID_COMMAND_REASON_ID "07101"
#define SENSOR_STREAM_RUNTIME_REASON_ID "07102"

typedef enum {
    SENSOR_STREAM_ACTION_START = 0,
    SENSOR_STREAM_ACTION_STOP = 1,
} sensor_stream_action_t;

typedef struct {
    sensor_stream_action_t action;
    uint32_t interval_ms;
} sensor_stream_command_t;

static const char *calibration_pressure_mode_to_string(calibration_pressure_mode_t mode)
{
    switch (mode) {
        case CALIBRATION_PRESSURE_REQUIRED:
            return "REQUIRED";
        case CALIBRATION_PRESSURE_OPTIONAL:
            return "OPTIONAL";
        case CALIBRATION_HALL_ONLY:
            return "HALL_ONLY";
        case CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE:
            return "HALL_WITH_LAST_STABLE_PRESSURE";
        default:
            return "OPTIONAL";
    }
}

static uint32_t clamp_interval_ms(uint32_t interval_ms)
{
    if (interval_ms < SENSOR_STREAM_MIN_INTERVAL_MS) {
        return SENSOR_STREAM_MIN_INTERVAL_MS;
    }
    if (interval_ms > SENSOR_STREAM_MAX_INTERVAL_MS) {
        return SENSOR_STREAM_MAX_INTERVAL_MS;
    }
    return interval_ms;
}

static uint32_t pressure_saturation_mask_from_sample(const cpr_sensor_sample_t *sample)
{
    uint32_t mask = 0u;
    if (sensor_conversion_pressure_raw_is_saturated(sample->pressure_0_raw)) mask |= 0x01u;
    if (sensor_conversion_pressure_raw_is_saturated(sample->pressure_1_raw)) mask |= 0x02u;
    if (sensor_conversion_pressure_raw_is_saturated(sample->pressure_2_raw)) mask |= 0x04u;
    return mask;
}

static sensor_conversion_profile_t conversion_profile_from_calibration(
    const calibration_config_t *calibration)
{
    sensor_conversion_profile_t profile = {
        .pressure_baseline_raw = {
            calibration->pressure_0_baseline,
            calibration->pressure_1_baseline,
            calibration->pressure_2_baseline,
        },
        .pressure_baseline_valid = {
            calibration->pressure_0_baseline != 0,
            calibration->pressure_1_baseline != 0,
            calibration->pressure_2_baseline != 0,
        },
        .pressure_kpa_per_count = {
            calibration->pressure_0_kpa_per_count,
            calibration->pressure_1_kpa_per_count,
            calibration->pressure_2_kpa_per_count,
        },
        .hall_baseline_raw = calibration->hall_baseline,
        .hall_baseline_valid = calibration->hall_baseline > 0,
        .hall_range_raw = calibration->hall_range_raw,
        .hall_direction = (int8_t)calibration->hall_direction,
        .full_depth_mm = calibration->full_depth_mm,
        .required_pressure_mask = SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK,
    };
    return profile;
}

static esp_err_t parse_sensor_stream_command(const char *payload, sensor_stream_command_t *out_command)
{
    if (payload == NULL || out_command == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    char request_id[128] = {0};
    if (resq_command_extract_request_id(payload, request_id, sizeof(request_id)) != ESP_OK) {
        return ESP_ERR_NOT_FOUND;
    }

    cJSON *root = cJSON_Parse(payload);
    if (root == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t result = ESP_OK;
    cJSON *action = cJSON_GetObjectItemCaseSensitive(root, "action");
    if (!cJSON_IsString(action) || action->valuestring == NULL || action->valuestring[0] == '\0') {
        result = ESP_ERR_INVALID_ARG;
        goto exit;
    }

    if (strcmp(action->valuestring, "START") == 0 || strcmp(action->valuestring, "start") == 0) {
        out_command->action = SENSOR_STREAM_ACTION_START;
        out_command->interval_ms = SENSOR_STREAM_DEFAULT_INTERVAL_MS;
        cJSON *interval = cJSON_GetObjectItemCaseSensitive(root, "interval_ms");
        if (cJSON_IsNumber(interval)) {
            int value = interval->valueint;
            if (value < SENSOR_STREAM_MIN_INTERVAL_MS || value > SENSOR_STREAM_MAX_INTERVAL_MS) {
                result = ESP_ERR_INVALID_ARG;
                goto exit;
            }
            out_command->interval_ms = (uint32_t)value;
        }
    } else if (strcmp(action->valuestring, "STOP") == 0 || strcmp(action->valuestring, "stop") == 0) {
        out_command->action = SENSOR_STREAM_ACTION_STOP;
        out_command->interval_ms = SENSOR_STREAM_DEFAULT_INTERVAL_MS;
    } else {
        result = ESP_ERR_INVALID_ARG;
    }

exit:
    cJSON_Delete(root);
    return result;
}

static esp_err_t sensor_stream_read_sample(cpr_sensor_sample_t *out_sample)
{
    if (out_sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_sample, 0, sizeof(*out_sample));
    out_sample->ts_ms = esp_timer_get_time() / 1000;

    esp_err_t first_error = ESP_OK;
    int32_t p0 = 0;
    int32_t p1 = 0;
    int32_t p2 = 0;
    esp_err_t pressure_err = hx710_read_3_shared_sck(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT,
        BOARD_HX710_1_DOUT,
        BOARD_HX710_2_DOUT,
        &p0,
        &p1,
        &p2);
    if (pressure_err == ESP_OK) {
        out_sample->pressure_0_raw = p0;
        out_sample->pressure_1_raw = p1;
        out_sample->pressure_2_raw = p2;
    } else {
        out_sample->quality_flags |= CPR_SAMPLE_PRESSURE_READ_FAILED;
        first_error = pressure_err;
    }

    hall_sensor_t hall = {0};
    esp_err_t hall_err = hall_sensor_init(&hall, BOARD_HALL_ADC_CHAN);
    if (hall_err == ESP_OK) {
        int hall_raw = 0;
        hall_err = hall_sensor_read_raw(&hall, &hall_raw);
        if (hall_err == ESP_OK) {
            out_sample->hall_raw = (int32_t)hall_raw;
        }
    }

    if (hall_err != ESP_OK) {
        out_sample->quality_flags |= CPR_SAMPLE_HALL_READ_FAILED;
        if (first_error == ESP_OK) {
            first_error = hall_err;
        }
    }

    return first_error;
}

static esp_err_t sensor_stream_publish_sample(const cpr_sensor_sample_t *sample,
                                              const calibration_config_t *calibration,
                                              resq_state_t state,
                                              uint32_t interval_ms)
{
    if (sample == NULL || calibration == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    bool pressure_read_ok = (sample->quality_flags & CPR_SAMPLE_PRESSURE_READ_FAILED) == 0;
    bool hall_read_ok = (sample->quality_flags & CPR_SAMPLE_HALL_READ_FAILED) == 0;

    sensor_raw_sample_t raw = {
        .pressure_raw = {
            sample->pressure_0_raw,
            sample->pressure_1_raw,
            sample->pressure_2_raw,
        },
        .pressure_read_valid = {
            pressure_read_ok,
            pressure_read_ok,
            pressure_read_ok,
        },
        .hall_raw = sample->hall_raw,
        .hall_read_valid = hall_read_ok,
        .pressure_saturation_mask = pressure_read_ok ?
            pressure_saturation_mask_from_sample(sample) : 0u,
        .timestamp_ms = sample->ts_ms,
    };
    sensor_conversion_profile_t profile = conversion_profile_from_calibration(calibration);
    sensor_converted_sample_t converted = {0};
    sensor_conversion_convert(&raw, &profile, &converted);

    bool pressure_0_kpa_valid = pressure_read_ok &&
                                calibration->pressure_valid &&
                                converted.pressure_kpa_channel_valid[0];
    bool pressure_1_kpa_valid = pressure_read_ok &&
                                calibration->pressure_valid &&
                                converted.pressure_kpa_channel_valid[1];
    bool pressure_2_kpa_valid = pressure_read_ok &&
                                calibration->pressure_valid &&
                                converted.pressure_kpa_channel_valid[2];
    bool pressure_kpa_valid = pressure_0_kpa_valid &&
                              pressure_1_kpa_valid &&
                              pressure_2_kpa_valid;
    bool hall_mm_valid =
        hall_read_ok &&
        calibration->hall_valid &&
        converted.hall_mm_valid;

    char payload[1152];
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"event_id\":%d,"
                           "\"device_id\":\"%s\","
                           "\"telemetry_mode\":\"SENSOR_STREAM\","
                           "\"state\":\"%s\","
                           "\"pressure_0_kpa\":%.3f,"
                           "\"pressure_0_kpa_valid\":%s,"
                           "\"pressure_1_kpa\":%.3f,"
                           "\"pressure_1_kpa_valid\":%s,"
                           "\"pressure_2_kpa\":%.3f,"
                           "\"pressure_2_kpa_valid\":%s,"
                           "\"hall_mm\":%.3f,"
                           "\"hall_progress\":%.3f,"
                           "\"pressure_kpa_valid\":%s,"
                           "\"hall_mm_valid\":%s,"
                           "\"pressure_saturation_mask\":%u,"
                           "\"interval_ms\":%" PRIu32 ","
                           "\"ts_ms\":%lld"
                           "}",
                           SENSOR_STREAM_EVENT_ID,
                           runtime_helpers_get_device_id(NULL),
                           resq_state_to_string(state),
                           pressure_0_kpa_valid ? converted.pressure_kpa[0] : 0.0f,
                           pressure_0_kpa_valid ? "true" : "false",
                           pressure_1_kpa_valid ? converted.pressure_kpa[1] : 0.0f,
                           pressure_1_kpa_valid ? "true" : "false",
                           pressure_2_kpa_valid ? converted.pressure_kpa[2] : 0.0f,
                           pressure_2_kpa_valid ? "true" : "false",
                           hall_mm_valid ? converted.hall_mm : 0.0f,
                           hall_mm_valid ? converted.hall_progress : 0.0f,
                           pressure_kpa_valid ? "true" : "false",
                           hall_mm_valid ? "true" : "false",
                           (unsigned int)(pressure_read_ok ? converted.pressure_saturation_mask : 0),
                           interval_ms,
                           (long long)sample->ts_ms);

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_telemetry_json(payload);
}

static void sensor_stream_task(void *arg)
{
    (void)arg;

    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT);
    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT);
    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT);

    xEventGroupSetBits(s_task_events, SENSOR_STREAM_TASK_STARTED_BIT);
    TickType_t last_wake = xTaskGetTickCount();

    while (s_sensor_stream_running) {
        uint32_t interval_ms = SENSOR_STREAM_DEFAULT_INTERVAL_MS;
        resq_state_t state = RESQ_STATE_PAIRED_IDLE;
        calibration_config_t calibration = {0};

        if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            interval_ms = s_sensor_stream_interval_ms;
            state = s_sensor_stream_state;
            memcpy(&calibration, &s_sensor_stream_calibration, sizeof(calibration));
            xSemaphoreGive(s_mutex);
        }

        cpr_sensor_sample_t sample = {0};
        sensor_stream_read_sample(&sample);
        sensor_stream_publish_sample(&sample, &calibration, state, interval_ms);

        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(interval_ms));
    }

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_sensor_stream_running = false;
    s_sensor_stream_task = NULL;
    xSemaphoreGive(s_mutex);

    xEventGroupSetBits(s_task_events, SENSOR_STREAM_TASK_STOPPED_BIT);
    vTaskDelete(NULL);
}

esp_err_t telemetry_publisher_build_session_payload(const cpr_metrics_snapshot_t *snap,
                                                     const char *device_id,
                                                     const char *session_id,
                                                     char *out_payload,
                                                     size_t out_payload_len)
{
    if (snap == NULL || out_payload == NULL || out_payload_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int written = snprintf(out_payload, out_payload_len,
        "{"
        "\"event_type\":\"session_telemetry\","
        "\"device_id\":\"%s\","
        "\"session_id\":\"%s\","
        "\"state\":\"SESSION_ACTIVE\","
        "\"depth_progress\":%.3f,"
        "\"depth_mm\":%.3f,"
        "\"depth_source\":\"HALL\","
        "\"depth_ok\":%s,"
        "\"rate_cpm\":%.1f,"
        "\"compression_count\":%d,"
        "\"valid_compression_count\":%d,"
        "\"recoil_ok_count\":%d,"
        "\"incomplete_recoil_count\":%d,"
        "\"pause_s\":%.3f,"
        "\"hand_placement\":\"%s\","
        "\"pressure_balance_pct\":%.2f,"
        "\"pressure_balance_reliable\":%s,"
        "\"pressure_mode\":\"%s\","
        "\"pressure_valid\":%s,"
        "\"pressure_degraded\":%s,"
        "\"using_last_stable_pressure\":%s,"
        "\"hall_valid\":%s,"
        "\"pressure_0_kpa\":%.3f,"
        "\"pressure_0_kpa_valid\":%s,"
        "\"pressure_1_kpa\":%.3f,"
        "\"pressure_1_kpa_valid\":%s,"
        "\"pressure_2_kpa\":%.3f,"
        "\"pressure_2_kpa_valid\":%s,"
        "\"pressure_kpa_valid\":%s,"
        "\"hall_mm_valid\":%s,"
        "\"pressure_saturation_mask\":%u,"
        "\"sensor_quality_flags\":%u,"
        "\"missed_pressure_samples\":%d,"
        "\"missed_hall_samples\":%d,"
        "\"flags\":\"%s\","
        "\"ts_ms\":%lld"
        "}",
        device_id ? device_id : "",
        session_id ? session_id : "",
        snap->depth_progress,
        snap->hall_mm_valid ? snap->depth_mm : 0.0f,
        snap->depth_ok ? "true" : "false",
        snap->rate_cpm,
        snap->total_compressions,
        snap->valid_compressions,
        snap->recoil_ok_count,
        snap->incomplete_recoil_count,
        snap->pause_s,
        snap->hand_placement,
        snap->pressure_balance_pct,
        snap->pressure_balance_reliable ? "true" : "false",
        calibration_pressure_mode_to_string(snap->pressure_mode),
        snap->pressure_valid ? "true" : "false",
        snap->pressure_degraded ? "true" : "false",
        snap->using_last_stable_pressure ? "true" : "false",
        snap->hall_valid ? "true" : "false",
        snap->pressure_0_kpa_valid ? snap->pressure_0_kpa : 0.0f,
        snap->pressure_0_kpa_valid ? "true" : "false",
        snap->pressure_1_kpa_valid ? snap->pressure_1_kpa : 0.0f,
        snap->pressure_1_kpa_valid ? "true" : "false",
        snap->pressure_2_kpa_valid ? snap->pressure_2_kpa : 0.0f,
        snap->pressure_2_kpa_valid ? "true" : "false",
        snap->pressure_kpa_valid ? "true" : "false",
        snap->hall_mm_valid ? "true" : "false",
        (unsigned int)snap->pressure_saturation_mask,
        (unsigned int)snap->sensor_quality_flags,
        snap->missed_pressure_samples,
        snap->missed_hall_samples,
        snap->flags,
        (long long)snap->ts_ms);

    if (written <= 0 || written >= (int)out_payload_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    return ESP_OK;
}

static void telemetry_task(void *arg)
{
    (void)arg;

    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STARTED_BIT);

    while (s_running) {
        if (!mqtt_manager_is_connected() || !session_manager_is_active()) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
            continue;
        }

        cpr_metrics_snapshot_t snap = {0};
        if (cpr_metrics_get_snapshot(&snap) != ESP_OK) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
            continue;
        }

        char payload[1792];
        const char *device_id = runtime_helpers_get_device_id(NULL);
        const char *session_id = session_manager_get_session_id();

        if (telemetry_publisher_build_session_payload(&snap,
                                                      device_id,
                                                      session_id,
                                                      payload,
                                                      sizeof(payload)) == ESP_OK) {
            mqtt_manager_publish_telemetry_json(payload);
        }

        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(200));
    }

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_running = false;
    s_task = NULL;
    xSemaphoreGive(s_mutex);

    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);
    vTaskDelete(NULL);
}

esp_err_t telemetry_publisher_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) return ESP_ERR_NO_MEM;
    }

    if (s_task_events == NULL) {
        s_task_events = xEventGroupCreate();
        if (s_task_events == NULL) return ESP_ERR_NO_MEM;
    }

    s_running = false;
    s_task = NULL;
    s_sensor_stream_running = false;
    s_sensor_stream_task = NULL;
    xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);
    xEventGroupSetBits(s_task_events, SENSOR_STREAM_TASK_STOPPED_BIT);

    return ESP_OK;
}

esp_err_t telemetry_publisher_start(void)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task != NULL) {
        esp_err_t result = s_running ? ESP_OK : ESP_ERR_INVALID_STATE;
        xSemaphoreGive(s_mutex);
        return result;
    }

    xEventGroupClearBits(s_task_events,
                         TELEMETRY_TASK_STARTED_BIT | TELEMETRY_TASK_STOPPED_BIT);
    s_running = true;
    BaseType_t ok = xTaskCreate(telemetry_task, "telemetry_task", 4096, NULL, 5, &s_task);
    if (ok != pdPASS) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        xEventGroupSetBits(s_task_events, TELEMETRY_TASK_STOPPED_BIT);
        return ESP_FAIL;
    }

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        TELEMETRY_TASK_STARTED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(TELEMETRY_TASK_START_TIMEOUT_MS));

    if ((bits & TELEMETRY_TASK_STARTED_BIT) == 0) {
        telemetry_publisher_stop();
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t telemetry_publisher_stop(void)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task == NULL) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_running = false;
    TaskHandle_t task = s_task;
    xTaskNotifyGive(task);

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        TELEMETRY_TASK_STOPPED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(TELEMETRY_TASK_STOP_TIMEOUT_MS));

    return (bits & TELEMETRY_TASK_STOPPED_BIT) ? ESP_OK : ESP_ERR_TIMEOUT;
}

esp_err_t telemetry_publisher_stop_all(void)
{
    esp_err_t first_error = ESP_OK;

    esp_err_t err = telemetry_publisher_stop_sensor_stream();
    if (err != ESP_OK && first_error == ESP_OK) {
        first_error = err;
    }

    err = telemetry_publisher_stop();
    if (err != ESP_OK && first_error == ESP_OK) {
        first_error = err;
    }

    return first_error;
}

bool telemetry_publisher_is_running(void)
{
    bool running = false;
    if (s_mutex == NULL) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    running = s_running && s_task != NULL;
    xSemaphoreGive(s_mutex);
    return running;
}

esp_err_t telemetry_publisher_start_sensor_stream(uint32_t interval_ms,
                                                  resq_state_t state,
                                                  const calibration_config_t *calibration_config)
{
    if (s_mutex == NULL || s_task_events == NULL || calibration_config == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    interval_ms = clamp_interval_ms(interval_ms == 0 ? SENSOR_STREAM_DEFAULT_INTERVAL_MS : interval_ms);

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    s_sensor_stream_interval_ms = interval_ms;
    s_sensor_stream_state = state;
    memcpy(&s_sensor_stream_calibration, calibration_config, sizeof(s_sensor_stream_calibration));

    if (s_sensor_stream_task != NULL) {
        esp_err_t result = s_sensor_stream_running ? ESP_OK : ESP_ERR_INVALID_STATE;
        xSemaphoreGive(s_mutex);
        return result;
    }

    xEventGroupClearBits(s_task_events,
                         SENSOR_STREAM_TASK_STARTED_BIT | SENSOR_STREAM_TASK_STOPPED_BIT);
    s_sensor_stream_running = true;
    BaseType_t ok = xTaskCreate(sensor_stream_task,
                                "sensor_stream",
                                4096,
                                NULL,
                                5,
                                &s_sensor_stream_task);
    if (ok != pdPASS) {
        s_sensor_stream_running = false;
        s_sensor_stream_task = NULL;
        xSemaphoreGive(s_mutex);
        xEventGroupSetBits(s_task_events, SENSOR_STREAM_TASK_STOPPED_BIT);
        return ESP_FAIL;
    }

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        SENSOR_STREAM_TASK_STARTED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(SENSOR_STREAM_TASK_START_TIMEOUT_MS));

    if ((bits & SENSOR_STREAM_TASK_STARTED_BIT) == 0) {
        telemetry_publisher_stop_sensor_stream();
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t telemetry_publisher_stop_sensor_stream(void)
{
    if (s_mutex == NULL || s_task_events == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_sensor_stream_task == NULL) {
        s_sensor_stream_running = false;
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_sensor_stream_running = false;
    TaskHandle_t task = s_sensor_stream_task;
    xTaskNotifyGive(task);
    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        SENSOR_STREAM_TASK_STOPPED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(SENSOR_STREAM_TASK_STOP_TIMEOUT_MS));

    return (bits & SENSOR_STREAM_TASK_STOPPED_BIT) ? ESP_OK : ESP_ERR_TIMEOUT;
}

bool telemetry_publisher_is_sensor_stream_running(void)
{
    bool running = false;
    if (s_mutex == NULL) {
        return false;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        return false;
    }
    running = s_sensor_stream_running && s_sensor_stream_task != NULL;
    xSemaphoreGive(s_mutex);
    return running;
}

esp_err_t telemetry_publisher_handle_sensor_stream_command(const network_config_t *network_config,
                                                           resq_state_t state,
                                                           const calibration_config_t *calibration_config,
                                                           const resq_mqtt_command_t *command,
                                                           bool allow_start)
{
    if (network_config == NULL || calibration_config == NULL || command == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    sensor_stream_command_t stream_command = {0};
    esp_err_t parse_err = parse_sensor_stream_command(command->payload, &stream_command);
    if (parse_err != ESP_OK) {
        runtime_helpers_publish_command_result_from_command(network_config,
                                                            state,
                                                            command,
                                                            RESQ_SUFFIX_CMD_TELEMETRY,
                                                            "NACK",
                                                            SENSOR_STREAM_INVALID_COMMAND_REASON_ID);
        return parse_err;
    }

    if (stream_command.action == SENSOR_STREAM_ACTION_STOP) {
        esp_err_t stop_err = telemetry_publisher_stop_sensor_stream();
        runtime_helpers_publish_command_result_from_command(network_config,
                                                            state,
                                                            command,
                                                            RESQ_SUFFIX_CMD_TELEMETRY,
                                                            stop_err == ESP_OK ? "ACK" : "NACK",
                                                            stop_err == ESP_OK ? NULL : SENSOR_STREAM_RUNTIME_REASON_ID);
        return stop_err;
    }

    if (!allow_start) {
        runtime_helpers_publish_command_result_from_command(network_config,
                                                            state,
                                                            command,
                                                            RESQ_SUFFIX_CMD_TELEMETRY,
                                                            "NACK",
                                                            "session_active_use_session_telemetry");
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t start_err = telemetry_publisher_start_sensor_stream(stream_command.interval_ms,
                                                                  state,
                                                                  calibration_config);
    runtime_helpers_publish_command_result_from_command(network_config,
                                                        state,
                                                        command,
                                                        RESQ_SUFFIX_CMD_TELEMETRY,
                                                        start_err == ESP_OK ? "ACK" : "NACK",
                                                        start_err == ESP_OK ? NULL : SENSOR_STREAM_RUNTIME_REASON_ID);
    return start_err;
}
