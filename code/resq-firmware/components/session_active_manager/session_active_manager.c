#include "session_active_manager.h"

#include <stdio.h>
#include <string.h>
#include <inttypes.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#include "cJSON.h"

#include "runtime_helpers.h"
#include "mqtt_manager.h"
#include "session_manager.h"
#include "cpr_metrics.h"
#include "buzzer_manager.h"
#include "telemetry_publisher.h"
#include "calibration_manager.h"
#include "hx710.h"
#include "hall_sensor.h"
#include "wifi_manager.h"
#include "board_config.h"

static const char *TAG = "session_active_mgr";

static TaskHandle_t s_sensor_task = NULL;
static volatile bool s_sensor_task_run = false;
static SemaphoreHandle_t s_mutex = NULL;

static void session_sensor_task(void *arg)
{
    (void)arg;

    hall_sensor_t local_hall = {0};
    if (hall_sensor_init(&local_hall, BOARD_HALL_ADC_CHAN) != ESP_OK) {
        ESP_LOGW(TAG, "hall_sensor_init failed");
    }

    hx710_init(BOARD_HX710_0_SCK, BOARD_HX710_0_DOUT);
    hx710_init(BOARD_HX710_1_SCK, BOARD_HX710_1_DOUT);
    hx710_init(BOARD_HX710_2_SCK, BOARD_HX710_2_DOUT);

    while (s_sensor_task_run) {
        cpr_sensor_sample_t sample = {0};
        sample.ts_ms = esp_timer_get_time() / 1000;

        sample.pressure_0_raw = hx710_read(BOARD_HX710_0_SCK, BOARD_HX710_0_DOUT);
        sample.pressure_1_raw = hx710_read(BOARD_HX710_1_SCK, BOARD_HX710_1_DOUT);
        sample.pressure_2_raw = hx710_read(BOARD_HX710_2_SCK, BOARD_HX710_2_DOUT);

        int hall_raw = 0;
        if (hall_sensor_read_raw(&local_hall, &hall_raw) == ESP_OK) {
            sample.hall_raw = hall_raw;
        }

        cpr_metrics_update(&sample);

        vTaskDelay(pdMS_TO_TICKS(20));
    }

    vTaskDelete(NULL);
}

esp_err_t session_active_manager_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

resq_state_t session_active_manager_start(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address,
                                          const char *session_id,
                                          const char *profile_id,
                                          const char *command_id)
{
    if (network_config == NULL || calibration_config == NULL || session_id == NULL) {
        return RESQ_STATE_READY_FOR_SESSION;
    }

    if (!calibration_config->calibrated || !calibration_manager_is_ready()) {
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_READY_FOR_SESSION,
                                               "cmd/session/start",
                                               "NACK",
                                               "calibration_not_ready");
        return RESQ_STATE_READY_FOR_SESSION;
    }

    if (!wifi_manager_is_connected() || !mqtt_manager_is_connected()) {
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_READY_FOR_SESSION,
                                               "cmd/session/start",
                                               "NACK",
                                               "connectivity_not_ready");
        return RESQ_STATE_READY_FOR_SESSION;
    }

    /* start session manager */
    esp_err_t start_err = session_manager_start(session_id, profile_id ? profile_id : "");
    if (start_err != ESP_OK) {
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_READY_FOR_SESSION,
                                               "cmd/session/start",
                                               "NACK",
                                               "session_already_active");
        return RESQ_STATE_READY_FOR_SESSION;
    }

    /* reset metrics */
    cpr_metrics_reset(calibration_config);

    /* start buzzer and telemetry */
    buzzer_manager_start_metronome(110);
    telemetry_publisher_start();

    /* publish ack and session_started event */
    runtime_helpers_publish_command_result(network_config,
                                           RESQ_STATE_SESSION_ACTIVE,
                                           "cmd/session/start",
                                           "ACK",
                                           "session_started");

    char event[256];
    int written = snprintf(event, sizeof(event),
                           "{\"event_type\":\"session_started\"," 
                           "\"device_id\":\"%s\"," 
                           "\"session_id\":\"%s\"," 
                           "\"state\":\"SESSION_ACTIVE\"," 
                           "\"ts_ms\":%lld}",
                           runtime_helpers_get_device_id(network_config),
                           session_id,
                           (long long)(esp_timer_get_time() / 1000));

    if (written > 0 && mqtt_manager_is_connected()) {
        mqtt_manager_publish_event_json(event);
    }

    /* publish retained status */
    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_SESSION_ACTIVE,
                                    network_config,
                                    calibration_config,
                                    true,
                                    session_id,
                                    ip_address);
    }

    return RESQ_STATE_SESSION_ACTIVE;
}

resq_state_t session_active_manager_run(network_config_t *network_config,
                                        calibration_config_t *calibration_config,
                                        const char *ip_address)
{
    if (network_config == NULL || calibration_config == NULL) {
        return RESQ_STATE_ERROR;
    }

    /* start sensor task */
    s_sensor_task_run = true;
    BaseType_t ok = xTaskCreate(session_sensor_task, "session_sensor", 4096, NULL, 6, &s_sensor_task);
    if (ok != pdPASS) {
        s_sensor_task_run = false;
        return RESQ_STATE_ERROR;
    }

    /* command loop */
    while (true) {
        if (!wifi_manager_is_connected() || !mqtt_manager_is_connected()) {
            ESP_LOGW(TAG, "Connectivity lost during session");
            buzzer_manager_stop();
            telemetry_publisher_stop();
            s_sensor_task_run = false;
            session_manager_mark_interrupted("connectivity_lost");

            /* publish interrupted status */
            if (mqtt_manager_is_connected()) {
                mqtt_manager_publish_status(RESQ_STATE_SESSION_INTERRUPTED,
                                            network_config,
                                            calibration_config,
                                            false,
                                            session_manager_get_session_id(),
                                            ip_address);
            }

            return RESQ_STATE_SESSION_INTERRUPTED;
        }

        resq_mqtt_command_t command = {0};
        esp_err_t wait_err = mqtt_manager_wait_for_command(&command, pdMS_TO_TICKS(200));

        if (wait_err == ESP_ERR_TIMEOUT) {
            continue;
        }

        if (wait_err != ESP_OK) {
            ESP_LOGW(TAG, "Command wait failed during session");
            continue;
        }

        const char *command_suffix = runtime_helpers_get_command_suffix(command.topic);
        if (command_suffix == NULL) {
            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_SESSION_ACTIVE,
                                                   "unknown",
                                                   "NACK",
                                                   "invalid_command_topic");
            continue;
        }

        ESP_LOGI(TAG, "Session active command=%s", command_suffix);

        if (strcmp(command_suffix, "cmd/session/stop") == 0) {
            /* validate active session id if provided */
            /* attempt stop */
            const char *payload = command.payload;
            /* simple JSON parse for session_id or sessionId */
            char session_id[128] = {0};
            cJSON *root = cJSON_Parse(payload);
            if (root) {
                cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
                if (!cJSON_IsString(sid) || sid->valuestring == NULL) {
                    sid = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
                }
                if (cJSON_IsString(sid) && sid->valuestring) {
                    strncpy(session_id, sid->valuestring, sizeof(session_id)-1);
                }
                cJSON_Delete(root);
            }

            esp_err_t stop_err = session_manager_stop(session_id[0] ? session_id : NULL);
            if (stop_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_SESSION_ACTIVE,
                                                       "cmd/session/stop",
                                                       "NACK",
                                                       "invalid_session_stop");
                continue;
            }

            buzzer_manager_stop();
            telemetry_publisher_stop();
            s_sensor_task_run = false;

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_SESSION_ACTIVE,
                                                   "cmd/session/stop",
                                                   "ACK",
                                                   "session_stopped");

            /* publish session_stopped event */
            char ev[512];
            cpr_metrics_snapshot_t snap = {0};
            cpr_metrics_get_snapshot(&snap);
            int written = snprintf(ev, sizeof(ev),
                                   "{\"event_type\":\"session_stopped\",\"device_id\":\"%s\",\"session_id\":\"%s\",\"total_compressions\":%d,\"valid_compressions\":%d,\"recoil_ok_count\":%d,\"incomplete_recoil_count\":%d,\"state\":\"READY_FOR_SESSION\",\"ts_ms\":%lld}",
                                   runtime_helpers_get_device_id(network_config),
                                   session_manager_get_session_id(),
                                   snap.total_compressions,
                                   snap.valid_compressions,
                                   snap.recoil_ok_count,
                                   snap.incomplete_recoil_count,
                                   (long long)(esp_timer_get_time() / 1000));
            if (written > 0 && mqtt_manager_is_connected()) {
                mqtt_manager_publish_event_json(ev);
                mqtt_manager_publish_status(RESQ_STATE_READY_FOR_SESSION,
                                            network_config,
                                            calibration_config,
                                            false,
                                            "",
                                            ip_address);
            }

            return RESQ_STATE_READY_FOR_SESSION;
        }

        if (strcmp(command_suffix, "cmd/session/start") == 0) {
            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_SESSION_ACTIVE,
                                                   "cmd/session/start",
                                                   "NACK",
                                                   "session_already_active");
            continue;
        }

        if (strcmp(command_suffix, "cmd/calibration/start") == 0 || strcmp(command_suffix, "cmd/calibration/cancel") == 0) {
            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_SESSION_ACTIVE,
                                                   command_suffix,
                                                   "NACK",
                                                   "session_active");
            continue;
        }

        if (strcmp(command_suffix, "cmd/debug") == 0) {
            /* publish one debug snapshot */
            int32_t p0 = hx710_read(BOARD_HX710_0_SCK, BOARD_HX710_0_DOUT);
            int32_t p1 = hx710_read(BOARD_HX710_1_SCK, BOARD_HX710_1_DOUT);
            int32_t p2 = hx710_read(BOARD_HX710_2_SCK, BOARD_HX710_2_DOUT);
            int32_t hall = 0;

            hall_sensor_t local_h = {0};
            if (hall_sensor_init(&local_h, BOARD_HALL_ADC_CHAN) == ESP_OK) {
                int hall_raw = 0;
                if (hall_sensor_read_raw(&local_h, &hall_raw) == ESP_OK) {
                    hall = (int32_t)hall_raw;
                }
            }

            char dbg[384];
            int written = snprintf(dbg,
                                sizeof(dbg),
                                "{"
                                "\"device_id\":\"%s\","
                                "\"pressure_0_raw\":%" PRId32 ","
                                "\"pressure_1_raw\":%" PRId32 ","
                                "\"pressure_2_raw\":%" PRId32 ","
                                "\"hall_raw\":%" PRId32 ","
                                "\"ts_ms\":%lld"
                                "}",
                                runtime_helpers_get_device_id(network_config),
                                p0,
                                p1,
                                p2,
                                hall,
                                (long long)(esp_timer_get_time() / 1000));

            if (written > 0 && mqtt_manager_is_connected()) {
                mqtt_manager_publish_debug_json(dbg);
            }

            runtime_helpers_publish_command_result(network_config,
                                                   RESQ_STATE_SESSION_ACTIVE,
                                                   "cmd/debug",
                                                   "ACK",
                                                   "debug_published");
            continue;
        }

        /* unknown command */
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_SESSION_ACTIVE,
                                               command_suffix,
                                               "NACK",
                                               "unknown_command");
    }

    return RESQ_STATE_READY_FOR_SESSION;
}
