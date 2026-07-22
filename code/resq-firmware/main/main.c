#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "adc_shared_service.h"
#include "backend_register_client.h"
#include "board_config.h"
#include "buzzer_manager.h"
#include "calibration_fail_manager.h"
#include "calibration_manager.h"
#include "calibration_state_manager.h"
#include "config_store.h"
#include "cpr_metrics.h"
#include "error_manager.h"
#include "firmware_state_machine.h"
#include "hx710.h"
#include "io_mode_manager.h"
#include "mqtt_manager.h"
#include "paired_idle_manager.h"
#include "provisioning_manager.h"
#include "runtime_identity.h"
#include "session_active_manager.h"
#include "session_manager.h"
#include "status_indicator.h"
#include "system_button_manager.h"
#include "telemetry_publisher.h"
#include "wifi_manager.h"

#define MAIN_LOOP_DELAY_MS 100
#define HEARTBEAT_INTERVAL_MS 5000
#define HEARTBEAT_TASK_STACK_SIZE 3072
#define HEARTBEAT_TASK_PRIORITY 3

static const char *TAG = "resq_main";
static bool s_components_initialized;
static TaskHandle_t s_heartbeat_task;
static volatile bool s_heartbeat_running;
static resq_fsm_t s_fsm;
static StaticSemaphore_t s_heartbeat_snapshot_mutex_storage;
static SemaphoreHandle_t s_heartbeat_snapshot_mutex;

typedef struct {
    network_config_t network_config;
    calibration_config_t calibration_config;
    resq_state_t state;
    char ip_address[sizeof(s_fsm.ip_address)];
} heartbeat_snapshot_t;

static heartbeat_snapshot_t s_heartbeat_snapshot;

static void heartbeat_snapshot_update(void)
{
    if (s_heartbeat_snapshot_mutex == NULL ||
        xSemaphoreTake(s_heartbeat_snapshot_mutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "Unable to update heartbeat state snapshot");
        return;
    }

    s_heartbeat_snapshot.network_config = s_fsm.network_config;
    s_heartbeat_snapshot.calibration_config = s_fsm.calibration_config;
    s_heartbeat_snapshot.state = s_fsm.current_state;
    memcpy(s_heartbeat_snapshot.ip_address,
           s_fsm.ip_address,
           sizeof(s_heartbeat_snapshot.ip_address));
    xSemaphoreGive(s_heartbeat_snapshot_mutex);
}

static esp_err_t initialize_components_once(void)
{
    if (s_components_initialized) {
        return ESP_OK;
    }

    esp_err_t err = config_store_init();
    if (err != ESP_OK) {
        return err;
    }

    err = io_mode_manager_init();
    if (err != ESP_OK) {
        return err;
    }

    err = provisioning_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = wifi_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = backend_register_client_init();
    if (err != ESP_OK) {
        return err;
    }
    err = runtime_identity_init();
    if (err != ESP_OK) {
        return err;
    }

    err = mqtt_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = paired_idle_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = session_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = system_button_manager_init();
    if (err != ESP_OK) {
        return err;
    }

    if (io_mode_manager_is_sensor()) {
        err = adc_shared_service_init();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "adc_shared_service_init failed: %s",
                     esp_err_to_name(err));
        }
        err = calibration_manager_init();
        if (err != ESP_OK) {
            return err;
        }
        err = calibration_fail_manager_init();
        if (err != ESP_OK) {
            return err;
        }
        err = cpr_metrics_init();
        if (err != ESP_OK) {
            return err;
        }
        err = buzzer_manager_init();
        if (err != ESP_OK) {
            return err;
        }
        err = telemetry_publisher_init();
        if (err != ESP_OK) {
            return err;
        }
        err = session_active_manager_init();
        if (err != ESP_OK) {
            return err;
        }
        err = hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
        if (err != ESP_OK) {
            return err;
        }
        ESP_LOGI(TAG, "Sensor-mode components initialized; shared HX710 SCK is LOW");
    } else {
        ESP_LOGI(TAG, "USB mode active; all pressure/HX710 initialization skipped");
    }

    s_components_initialized = true;
    ESP_LOGI(TAG, "Core firmware components initialized");
    return ESP_OK;
}

static void get_heartbeat_session(bool *active,
                                  bool *sensor_running,
                                  char *session_id,
                                  size_t session_id_len)
{
    *active = false;
    *sensor_running = session_active_manager_is_sensor_running();
    session_id[0] = '\0';

    session_state_t state = {0};
    if (session_manager_get_state(&state) != ESP_OK || !state.active) {
        return;
    }

    *active = true;
    strncpy(session_id, state.session_id, session_id_len - 1);
    session_id[session_id_len - 1] = '\0';
}

static void heartbeat_task(void *arg)
{
    (void)arg;

    while (s_heartbeat_running) {
        if (mqtt_manager_is_connected()) {
            heartbeat_snapshot_t snapshot = {0};
            if (xSemaphoreTake(s_heartbeat_snapshot_mutex,
                               pdMS_TO_TICKS(100)) != pdTRUE) {
                ESP_LOGW(TAG, "Unable to read heartbeat state snapshot");
                ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS));
                continue;
            }
            snapshot = s_heartbeat_snapshot;
            xSemaphoreGive(s_heartbeat_snapshot_mutex);

            char latest_ip[sizeof(snapshot.ip_address)] = {0};
            if (wifi_manager_get_ip(latest_ip, sizeof(latest_ip)) == ESP_OK) {
                strncpy(snapshot.ip_address,
                        latest_ip,
                        sizeof(snapshot.ip_address) - 1);
                snapshot.ip_address[sizeof(snapshot.ip_address) - 1] = '\0';
            }

            bool session_active;
            bool sensor_running;
            char session_id[RESQ_SESSION_ID_MAX_LEN];
            get_heartbeat_session(&session_active,
                                  &sensor_running,
                                  session_id,
                                  sizeof(session_id));

            esp_err_t err = mqtt_manager_publish_heartbeat(
                &snapshot.network_config,
                &snapshot.calibration_config,
                snapshot.state,
                session_active,
                sensor_running,
                session_id,
                snapshot.ip_address,
                wifi_manager_get_rssi());
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "Heartbeat publish failed: %s", esp_err_to_name(err));
            }
        }

        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS));
    }

    s_heartbeat_task = NULL;
    vTaskDelete(NULL);
}

static esp_err_t start_heartbeat_once(void)
{
    if (s_heartbeat_task != NULL) {
        return ESP_OK;
    }

    s_heartbeat_running = true;
    BaseType_t result = xTaskCreate(heartbeat_task,
                                    "heartbeat_task",
                                    HEARTBEAT_TASK_STACK_SIZE,
                                    NULL,
                                    HEARTBEAT_TASK_PRIORITY,
                                    &s_heartbeat_task);
    if (result != pdPASS) {
        s_heartbeat_running = false;
        s_heartbeat_task = NULL;
        return ESP_FAIL;
    }
    return ESP_OK;
}

static esp_err_t stop_heartbeat(void)
{
    TaskHandle_t task = s_heartbeat_task;
    if (task == NULL) {
        s_heartbeat_running = false;
        return ESP_OK;
    }

    s_heartbeat_running = false;
    xTaskNotifyGive(task);
    for (int waited_ms = 0; waited_ms < 1000; waited_ms += 10) {
        if (s_heartbeat_task == NULL) return ESP_OK;
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    return ESP_ERR_TIMEOUT;
}

static void delay_ms(uint32_t delay)
{
    vTaskDelay(pdMS_TO_TICKS(delay));
}

static void restart_device(void)
{
    esp_restart();
}

static void enter_soft_off(void)
{
    ESP_LOGW(TAG, "System is now in soft-off state");
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static const resq_fsm_ops_t s_fsm_ops = {
    .initialize_components = initialize_components_once,
    .sensor_mode_enabled = io_mode_manager_is_sensor,
    .network_set_defaults = network_config_set_defaults,
    .calibration_set_defaults = calibration_config_set_defaults,
    .network_validate = network_config_validate,
    .calibration_validate = calibration_config_validate,
    .load_network = config_store_load_network,
    .load_calibration = config_store_load_calibration,
    .save_network = config_store_save_network,
    .clear_network = config_store_clear_network,
    .clear_all = config_store_clear_all,
    .provisioning_start = provisioning_manager_start,
    .provisioning_stop = provisioning_manager_stop,
    .provisioning_has_saved_config = provisioning_manager_has_saved_config,
    .io_mode_get = io_mode_manager_get,
    .io_mode_request = io_mode_manager_request,
    .wifi_connect = wifi_manager_connect,
    .wifi_disconnect = wifi_manager_disconnect,
    .wifi_is_connected = wifi_manager_is_connected,
    .wifi_get_ip = wifi_manager_get_ip,
    .wifi_get_rssi = wifi_manager_get_rssi,
    .backend_register = backend_register_client_register,
    .mqtt_start = mqtt_manager_start,
    .mqtt_stop = mqtt_manager_stop,
    .mqtt_is_connected = mqtt_manager_is_connected,
    .mqtt_publish_identity = mqtt_manager_publish_identity_event,
    .mqtt_publish_status = mqtt_manager_publish_status,
    .mqtt_publish_heartbeat = mqtt_manager_publish_heartbeat,
    .start_heartbeat = start_heartbeat_once,
    .stop_heartbeat = stop_heartbeat,
    .paired_idle_run = paired_idle_manager_run,
    .calibration_run = calibration_state_manager_run,
    .calibration_fail_run = calibration_fail_manager_run,
    .session_active_run = session_active_manager_run,
    .session_has_pending_interruption =
        session_active_manager_has_pending_interruption,
    .session_publish_pending_interruption =
        session_active_manager_publish_pending_interruption,
    .session_sensor_is_running = session_active_manager_is_sensor_running,
    .error_run = error_manager_run,
    .error_set = error_manager_set_error,
    .session_is_active = session_manager_is_active,
    .session_get_state = session_manager_get_state,
    .session_get_id = session_manager_get_session_id,
    .session_stop = session_manager_stop,
    .buzzer_stop = buzzer_manager_stop,
    .telemetry_stop = telemetry_publisher_stop_all,
    .calibration_cancel = calibration_manager_cancel,
    .status_set_state = status_indicator_set_state,
    .status_set_both_leds_on = status_indicator_set_both_leds_on,
    .status_stop = status_indicator_stop,
    .button_poll = system_button_manager_poll,
    .button_take_event = system_button_manager_take_event,
    .button_drain_events = system_button_manager_drain_events,
    .button_drain_actions = system_button_manager_drain_actions,
    .delay_ms = delay_ms,
    .restart = restart_device,
    .enter_soft_off = enter_soft_off,
};

void app_main(void)
{
    esp_err_t err = esp_netif_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "esp_netif_init failed: %s", esp_err_to_name(err));
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "esp_event_loop_create_default failed: %s", esp_err_to_name(err));
    }

    ESP_ERROR_CHECK(status_indicator_init());
    ESP_ERROR_CHECK(status_indicator_start());

    err = system_button_manager_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "system_button_manager_init early init failed: %s",
                 esp_err_to_name(err));
    }
    err = error_manager_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "error_manager_init early init failed: %s",
                 esp_err_to_name(err));
    }

    ESP_ERROR_CHECK(resq_fsm_init(&s_fsm, &s_fsm_ops));
    s_heartbeat_snapshot_mutex =
        xSemaphoreCreateMutexStatic(&s_heartbeat_snapshot_mutex_storage);
    ESP_ERROR_CHECK(s_heartbeat_snapshot_mutex != NULL ? ESP_OK : ESP_ERR_NO_MEM);
    heartbeat_snapshot_update();

    while (true) {
        resq_fsm_step(&s_fsm);
        heartbeat_snapshot_update();
        vTaskDelay(pdMS_TO_TICKS(MAIN_LOOP_DELAY_MS));
    }
}
