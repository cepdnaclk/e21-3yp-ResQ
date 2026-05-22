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
#include "error_manager.h"
#include "calibration_manager.h"
#include "hx710.h"
#include "hall_sensor.h"
#include "wifi_manager.h"
#include "board_config.h"
#include "system_button_manager.h"

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

    /* Initialize HX710 sensors using shared SCK */
    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT);
    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT);
    hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT);

    while (s_sensor_task_run) {
        cpr_sensor_sample_t sample = {0};
        sample.ts_ms = esp_timer_get_time() / 1000;

        {
            int32_t p0 = 0, p1 = 0, p2 = 0;
            esp_err_t pressure_err = hx710_read_3_shared_sck(
                BOARD_HX710_SHARED_SCK,
                BOARD_HX710_0_DOUT,
                BOARD_HX710_1_DOUT,
                BOARD_HX710_2_DOUT,
                &p0,
                &p1,
                &p2);

            if (pressure_err != ESP_OK) {
                sample.pressure_0_raw = HX710_ERROR_TIMEOUT;
                sample.pressure_1_raw = HX710_ERROR_TIMEOUT;
                sample.pressure_2_raw = HX710_ERROR_TIMEOUT;
                ESP_LOGW(TAG, "Failed to read shared HX710 pressure sensors: %s", esp_err_to_name(pressure_err));
            } else {
                sample.pressure_0_raw = p0;
                sample.pressure_1_raw = p1;
                sample.pressure_2_raw = p2;
            }
        }

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

    /* start buzzer and telemetry (check failures) */
    esp_err_t buzz_err = buzzer_manager_start_metronome(110);
    if (buzz_err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start buzzer metronome: %s", esp_err_to_name(buzz_err));
        error_manager_set_error(FW_ERROR_BUZZER_TASK_FAILED);
        session_manager_stop(session_id);
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_READY_FOR_SESSION,
                                               "cmd/session/start",
                                               "NACK",
                                               "buzzer_start_failed");
        return RESQ_STATE_ERROR;
    }

    esp_err_t telemetry_err = telemetry_publisher_start();
    if (telemetry_err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start telemetry publisher: %s", esp_err_to_name(telemetry_err));
        buzzer_manager_stop();
        session_manager_stop(session_id);
        error_manager_set_error(FW_ERROR_TELEMETRY_TASK_FAILED);
        runtime_helpers_publish_command_result(network_config,
                                               RESQ_STATE_READY_FOR_SESSION,
                                               "cmd/session/start",
                                               "NACK",
                                               "telemetry_start_failed");
        return RESQ_STATE_ERROR;
    }

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

        /* try to stop components and session cleanly */
        session_state_t cur = {0};
        char stopped_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
        if (session_manager_get_state(&cur) == ESP_OK && cur.active) {
            strncpy(stopped_session_id, cur.session_id, sizeof(stopped_session_id) - 1);
            stopped_session_id[sizeof(stopped_session_id) - 1] = '\0';
        }

        telemetry_publisher_stop();
        buzzer_manager_stop();
        session_manager_stop(stopped_session_id[0] ? stopped_session_id : NULL);

        error_manager_set_error(FW_ERROR_SENSOR_RUNTIME_FAILED);

        return RESQ_STATE_ERROR;
    }

    /* command loop */
    while (true) {
        system_button_action_t action = system_button_manager_poll(RESQ_STATE_SESSION_ACTIVE);
        if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
            ESP_LOGW(TAG, "System button requested TURN_OFF during session");
            buzzer_manager_stop();
            telemetry_publisher_stop();
            s_sensor_task_run = false;
            session_manager_stop(NULL);
            return RESQ_STATE_TURN_OFF;
        }

        if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
            ESP_LOGW(TAG, "System button requested FACTORY_RESET during session");
            buzzer_manager_stop();
            telemetry_publisher_stop();
            s_sensor_task_run = false;
            session_manager_stop(NULL);
            return RESQ_STATE_RESETTING;
        }
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
            /* determine active session id (copy it before stopping) */
            session_state_t current_session = {0};
            char stopped_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
            if (session_manager_get_state(&current_session) == ESP_OK && current_session.active) {
                strncpy(stopped_session_id, current_session.session_id, sizeof(stopped_session_id) - 1);
                stopped_session_id[sizeof(stopped_session_id) - 1] = '\0';
            }

            /* if no active session, reject */
            if (stopped_session_id[0] == '\0') {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_SESSION_ACTIVE,
                                                       "cmd/session/stop",
                                                       "NACK",
                                                       "no_active_session");
                continue;
            }

            /* parse optional requested session id from payload */
            char requested_session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
            const char *payload = command.payload;
            if (payload && payload[0] != '\0') {
                cJSON *root = cJSON_Parse(payload);
                if (root) {
                    cJSON *sid = cJSON_GetObjectItemCaseSensitive(root, "session_id");
                    if (!cJSON_IsString(sid) || sid->valuestring == NULL) {
                        sid = cJSON_GetObjectItemCaseSensitive(root, "sessionId");
                    }
                    if (cJSON_IsString(sid) && sid->valuestring) {
                        strncpy(requested_session_id, sid->valuestring, sizeof(requested_session_id) - 1);
                        requested_session_id[sizeof(requested_session_id) - 1] = '\0';
                    }
                    cJSON_Delete(root);
                }
            }

            /* if payload contained a session id and it doesn't match active session, reject */
            if (requested_session_id[0] != '\0' && strcmp(requested_session_id, stopped_session_id) != 0) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_SESSION_ACTIVE,
                                                       "cmd/session/stop",
                                                       "NACK",
                                                       "session_id_mismatch");
                continue;
            }

            /* stop using preserved active session id */
            esp_err_t stop_err = session_manager_stop(stopped_session_id);
            if (stop_err != ESP_OK) {
                runtime_helpers_publish_command_result(network_config,
                                                       RESQ_STATE_SESSION_ACTIVE,
                                                       "cmd/session/stop",
                                                       "NACK",
                                                       "session_stop_failed");
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

            /* publish session_stopped event using copied session id */
            char ev[512];
            cpr_metrics_snapshot_t snap = {0};
            cpr_metrics_get_snapshot(&snap);
            int written = snprintf(ev, sizeof(ev),
                                   "{\"event_type\":\"session_stopped\",\"device_id\":\"%s\",\"session_id\":\"%s\",\"total_compressions\":%d,\"valid_compressions\":%d,\"recoil_ok_count\":%d,\"incomplete_recoil_count\":%d,\"state\":\"READY_FOR_SESSION\",\"ts_ms\":%lld}",
                                   runtime_helpers_get_device_id(network_config),
                                   stopped_session_id,
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
            int32_t p0 = 0, p1 = 0, p2 = 0;
            esp_err_t perr = hx710_read_3_shared_sck(
                BOARD_HX710_SHARED_SCK,
                BOARD_HX710_0_DOUT,
                BOARD_HX710_1_DOUT,
                BOARD_HX710_2_DOUT,
                &p0,
                &p1,
                &p2);
            if (perr != ESP_OK) {
                ESP_LOGW(TAG, "Failed to read shared HX710 for debug: %s", esp_err_to_name(perr));
                p0 = HX710_ERROR_TIMEOUT; p1 = HX710_ERROR_TIMEOUT; p2 = HX710_ERROR_TIMEOUT;
            }
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
