#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
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
#include "firmware_bootstrap.h"
#include "firmware_mqtt_contract.h"
#include "firmware_state_machine.h"
#include "hx710.h"
#include "io_mode_manager.h"
#include "mqtt_manager.h"
#include "paired_idle_manager.h"
#include "provisioning_manager.h"
#include "runtime_identity.h"
#include "session_active_manager.h"
#include "session_manager.h"
#include "sensor_owner.h"
#include "status_indicator.h"
#include "system_button_manager.h"
#include "task_diagnostics.h"
#include "telemetry_publisher.h"
#include "wifi_manager.h"

#define MAIN_LOOP_DELAY_MS 100
#define HEARTBEAT_TASK_STACK_SIZE 3072
#define HEARTBEAT_TASK_PRIORITY 3

static const char *TAG = "resq_main";
static bool s_components_initialized;
static firmware_bootstrap_context_t s_platform_bootstrap;
static firmware_bootstrap_context_t s_runtime_bootstrap;
static firmware_error_reason_id_t s_bootstrap_error_reason =
    FW_ERROR_UNKNOWN_ERROR;
static TaskHandle_t s_heartbeat_task;
static EventGroupHandle_t s_heartbeat_events;
static StaticSemaphore_t s_heartbeat_lifecycle_mutex_storage;
static SemaphoreHandle_t s_heartbeat_lifecycle_mutex;
#define HEARTBEAT_STOP_REQUESTED_BIT BIT0
#define HEARTBEAT_STARTED_BIT BIT1
#define HEARTBEAT_STOPPED_BIT BIT2
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

static esp_err_t bootstrap_event_loop_init(void)
{
    esp_err_t err = esp_event_loop_create_default();
    return err == ESP_ERR_INVALID_STATE ? ESP_OK : err;
}

static esp_err_t bootstrap_status_init(void)
{
    esp_err_t err = status_indicator_init();
    return err == ESP_OK ? status_indicator_start() : err;
}

static esp_err_t bootstrap_hx710_sck_acquire(void)
{
    return hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
}

static esp_err_t bootstrap_hx710_idle_low(void)
{
    return hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
}

static void cleanup_status(void)
{
    status_indicator_stop();
}

static void cleanup_provisioning(void)
{
    (void)provisioning_manager_stop();
}

static void cleanup_wifi(void)
{
    (void)wifi_manager_disconnect();
}

static void cleanup_mqtt(void)
{
    (void)mqtt_manager_stop();
}

static void cleanup_calibration(void)
{
    (void)calibration_manager_cancel();
}

static void cleanup_buzzer(void)
{
    (void)buzzer_manager_stop();
}

static void cleanup_telemetry(void)
{
    (void)telemetry_publisher_stop_all();
}

static esp_err_t initialize_platform_once(void)
{
    static const component_bootstrap_entry_t entries[] = {
        {"config_store", config_store_init, NULL, COMPONENT_CRITICAL, false},
        {"io_mode_manager", io_mode_manager_init, NULL, COMPONENT_CRITICAL,
         false},
        {"runtime_identity", runtime_identity_init, NULL, COMPONENT_CRITICAL,
         false},
        {"esp_netif", esp_netif_init, NULL, COMPONENT_CRITICAL, false},
        {"default_event_loop", bootstrap_event_loop_init, NULL,
         COMPONENT_CRITICAL, false},
        {"status_indicator", bootstrap_status_init, cleanup_status,
         COMPONENT_OPTIONAL, false},
        {"system_button_manager", system_button_manager_init, NULL,
         COMPONENT_CRITICAL, false},
        {"error_manager", error_manager_init, NULL, COMPONENT_CRITICAL, false},
    };
    bootstrap_result_t result = {0};
    esp_err_t err = firmware_bootstrap_run(
        &s_platform_bootstrap, entries, sizeof(entries) / sizeof(entries[0]),
        false, &result);
    if (err != ESP_OK) {
        s_bootstrap_error_reason =
            strcmp(result.component, "config_store") == 0
                ? FW_ERROR_NVS_INIT_FAILED
                : FW_ERROR_UNKNOWN_ERROR;
        return err;
    }
    if (result.error != ESP_OK) {
        ESP_LOGW(TAG, "Optional bootstrap component unavailable: %s (%s)",
                 result.component, esp_err_to_name(result.error));
    }
    return ESP_OK;
}

static esp_err_t request_io_mode_for_restart(resq_io_mode_t target)
{
    resq_io_mode_t active = io_mode_manager_get();
    if (target == active) {
        return io_mode_manager_request(target);
    }

    bool released_hx710 = false;
    if (active == RESQ_IO_MODE_SENSOR && target == RESQ_IO_MODE_USB) {
        sensor_owner_t owner = SENSOR_OWNER_NONE;
        esp_err_t err = sensor_owner_get(&owner);
        if (err != ESP_OK) {
            return err;
        }
        if (owner != SENSOR_OWNER_NONE) {
            ESP_LOGW(TAG,
                     "USB mode request rejected while sensor owner %d is active",
                     (int)owner);
            return ESP_ERR_INVALID_STATE;
        }
        err = hx710_sck_release_for_usb_mode();
        if (err != ESP_OK) {
            return err;
        }
        released_hx710 = true;
    }

    esp_err_t err = io_mode_manager_request(target);
    if (err != ESP_OK && released_hx710) {
        esp_err_t reacquire_err =
            hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
        if (reacquire_err != ESP_OK) {
            ESP_LOGE(TAG, "Failed to restore HX710 ownership after mode-save "
                          "failure: %s",
                     esp_err_to_name(reacquire_err));
        }
    }
    return err;
}

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

    static const component_bootstrap_entry_t entries[] = {
        {"provisioning_manager", provisioning_manager_init,
         cleanup_provisioning, COMPONENT_CRITICAL, false},
        {"wifi_manager", wifi_manager_init, cleanup_wifi, COMPONENT_CRITICAL,
         false},
        {"backend_register_client", backend_register_client_init, NULL,
         COMPONENT_CRITICAL, false},
        {"mqtt_manager", mqtt_manager_init, cleanup_mqtt, COMPONENT_CRITICAL,
         false},
        {"paired_idle_manager", paired_idle_manager_init, NULL,
         COMPONENT_CRITICAL, false},
        {"session_manager", session_manager_init, NULL, COMPONENT_CRITICAL,
         false},
        {"sensor_owner", sensor_owner_init, NULL, COMPONENT_CRITICAL, true},
        {"hx710_sck_ownership", bootstrap_hx710_sck_acquire, NULL,
         COMPONENT_CRITICAL, true},
        {"adc_shared_service", adc_shared_service_init, NULL,
         COMPONENT_CRITICAL, true},
        {"calibration_manager", calibration_manager_init, cleanup_calibration,
         COMPONENT_CRITICAL, true},
        {"calibration_fail_manager", calibration_fail_manager_init, NULL,
         COMPONENT_CRITICAL, true},
        {"cpr_metrics", cpr_metrics_init, NULL, COMPONENT_CRITICAL, true},
        {"buzzer_manager", buzzer_manager_init, cleanup_buzzer,
         COMPONENT_OPTIONAL, true},
        {"telemetry_publisher", telemetry_publisher_init, cleanup_telemetry,
         COMPONENT_CRITICAL, true},
        {"session_active_manager", session_active_manager_init, NULL,
         COMPONENT_CRITICAL, true},
        {"hx710_idle_low", bootstrap_hx710_idle_low, NULL, COMPONENT_CRITICAL,
         true},
    };
    bootstrap_result_t result = {0};
    bool sensor_mode = io_mode_manager_is_sensor();
    esp_err_t err = firmware_bootstrap_run(
        &s_runtime_bootstrap, entries, sizeof(entries) / sizeof(entries[0]),
        sensor_mode, &result);
    if (err != ESP_OK) {
        if (result.component != NULL &&
            (strstr(result.component, "hx710") != NULL ||
             strcmp(result.component, "adc_shared_service") == 0)) {
            s_bootstrap_error_reason = FW_ERROR_HX710_INIT_FAILED;
        } else if (result.component != NULL &&
                   (strcmp(result.component, "calibration_manager") == 0 ||
                    strcmp(result.component, "cpr_metrics") == 0 ||
                    strcmp(result.component, "telemetry_publisher") == 0 ||
                    strcmp(result.component, "session_active_manager") == 0)) {
            s_bootstrap_error_reason = FW_ERROR_SENSOR_RUNTIME_FAILED;
        } else {
            s_bootstrap_error_reason = FW_ERROR_UNKNOWN_ERROR;
        }
        return err;
    }
    if (result.error != ESP_OK) {
        ESP_LOGW(TAG, "Optional bootstrap component unavailable: %s (%s)",
                 result.component, esp_err_to_name(result.error));
    }

    if (sensor_mode) {
        ESP_LOGI(TAG, "Sensor-mode components initialized; shared HX710 SCK is LOW");
    } else {
        ESP_LOGI(TAG, "USB mode active; all pressure/HX710 initialization skipped");
    }

    s_components_initialized = true;
    ESP_LOGI(TAG, "Core firmware components initialized");
    return ESP_OK;
}

static firmware_error_reason_id_t initialization_error_reason(void)
{
    return s_bootstrap_error_reason;
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

static void heartbeat_wait_for_next(uint32_t *next_deadline_ms)
{
    uint32_t now_ms =
        (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
    *next_deadline_ms = resq_mqtt_contract_next_heartbeat_deadline(
        *next_deadline_ms, now_ms, RESQ_HEARTBEAT_INTERVAL_MS);
    uint32_t wait_ms = (int32_t)(*next_deadline_ms - now_ms) > 0
        ? *next_deadline_ms - now_ms
        : 0;
    (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(wait_ms));
}

static void heartbeat_task(void *arg)
{
    (void)arg;
    task_diagnostics_record_stack_watermark("heartbeat");
    xEventGroupSetBits(s_heartbeat_events, HEARTBEAT_STARTED_BIT);
    uint32_t next_deadline_ms = 0;

    while ((xEventGroupGetBits(s_heartbeat_events) &
            HEARTBEAT_STOP_REQUESTED_BIT) == 0) {
        if (mqtt_manager_is_connected()) {
            heartbeat_snapshot_t snapshot = {0};
            if (xSemaphoreTake(s_heartbeat_snapshot_mutex,
                               pdMS_TO_TICKS(100)) != pdTRUE) {
                ESP_LOGW(TAG, "Unable to read heartbeat state snapshot");
                heartbeat_wait_for_next(&next_deadline_ms);
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

            sensor_runtime_health_t runtime_health = {0};
            (void)calibration_manager_get_runtime_health(&runtime_health);
            if (session_active) {
                cpr_metrics_snapshot_t metrics = {0};
                if (cpr_metrics_get_snapshot(&metrics) == ESP_OK) {
                    runtime_health.pressure_acquisition_enabled =
                        snapshot.calibration_config.pressure_policy !=
                        CALIBRATION_HALL_ONLY;
                    runtime_health.pressure_current_valid =
                        metrics.pressure_valid;
                    runtime_health.pressure_temporarily_degraded =
                        metrics.pressure_temporarily_degraded;
                    runtime_health.using_last_stable_pressure =
                        metrics.pressure_using_last_stable;
                    runtime_health.hall_current_valid = metrics.hall_valid;
                    runtime_health.pressure_valid_mask =
                        metrics.pressure_current_valid_mask;
                    runtime_health.pressure_invalid_mask =
                        metrics.pressure_invalid_mask;
                    runtime_health.pressure_saturation_mask =
                        metrics.pressure_saturation_mask;
                    runtime_health.updated_at_ms = metrics.ts_ms;
                }
            }

            esp_err_t err = mqtt_manager_publish_heartbeat_with_health(
                &snapshot.network_config,
                &snapshot.calibration_config,
                &runtime_health,
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

        task_diagnostics_record_stack_watermark("heartbeat");
        heartbeat_wait_for_next(&next_deadline_ms);
    }

    task_diagnostics_record_stack_watermark("heartbeat");
    xSemaphoreTake(s_heartbeat_lifecycle_mutex, portMAX_DELAY);
    s_heartbeat_task = NULL;
    xSemaphoreGive(s_heartbeat_lifecycle_mutex);
    xEventGroupSetBits(s_heartbeat_events, HEARTBEAT_STOPPED_BIT);
    vTaskDelete(NULL);
}

static esp_err_t start_heartbeat_once(void)
{
    if (s_heartbeat_events == NULL) {
        s_heartbeat_events = xEventGroupCreate();
        if (s_heartbeat_events == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    if (s_heartbeat_lifecycle_mutex == NULL) {
        s_heartbeat_lifecycle_mutex = xSemaphoreCreateMutexStatic(
            &s_heartbeat_lifecycle_mutex_storage);
        if (s_heartbeat_lifecycle_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    xSemaphoreTake(s_heartbeat_lifecycle_mutex, portMAX_DELAY);
    if (s_heartbeat_task != NULL) {
        xSemaphoreGive(s_heartbeat_lifecycle_mutex);
        return ESP_OK;
    }

    xEventGroupClearBits(s_heartbeat_events,
                         HEARTBEAT_STOP_REQUESTED_BIT |
                             HEARTBEAT_STARTED_BIT | HEARTBEAT_STOPPED_BIT);
    BaseType_t result = xTaskCreate(heartbeat_task,
                                    "heartbeat_task",
                                    HEARTBEAT_TASK_STACK_SIZE,
                                    NULL,
                                    HEARTBEAT_TASK_PRIORITY,
                                    &s_heartbeat_task);
    xSemaphoreGive(s_heartbeat_lifecycle_mutex);
    if (result != pdPASS) {
        xSemaphoreTake(s_heartbeat_lifecycle_mutex, portMAX_DELAY);
        s_heartbeat_task = NULL;
        xSemaphoreGive(s_heartbeat_lifecycle_mutex);
        return ESP_FAIL;
    }
    EventBits_t bits = xEventGroupWaitBits(
        s_heartbeat_events, HEARTBEAT_STARTED_BIT | HEARTBEAT_STOPPED_BIT,
        pdFALSE, pdFALSE, pdMS_TO_TICKS(1000));
    return (bits & HEARTBEAT_STARTED_BIT) != 0 ? ESP_OK : ESP_ERR_TIMEOUT;
}

static esp_err_t stop_heartbeat(void)
{
    xSemaphoreTake(s_heartbeat_lifecycle_mutex, portMAX_DELAY);
    TaskHandle_t task = s_heartbeat_task;
    xSemaphoreGive(s_heartbeat_lifecycle_mutex);
    if (task == NULL) {
        return ESP_OK;
    }

    xEventGroupSetBits(s_heartbeat_events, HEARTBEAT_STOP_REQUESTED_BIT);
    xTaskNotifyGive(task);
    EventBits_t bits = xEventGroupWaitBits(
        s_heartbeat_events, HEARTBEAT_STOPPED_BIT, pdFALSE, pdFALSE,
        pdMS_TO_TICKS(1000));
    return (bits & HEARTBEAT_STOPPED_BIT) != 0 ? ESP_OK : ESP_ERR_TIMEOUT;
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
    .initialization_error_reason = initialization_error_reason,
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
    .provisioning_take_saved_config =
        provisioning_manager_take_saved_config,
    .io_mode_get = io_mode_manager_get,
    .io_mode_request = request_io_mode_for_restart,
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
    /*
     * Resolve persistent state and platform services exactly once before the
     * FSM starts. The board-configured shared HX710 SCK is claimed later by
     * the SENSOR-only bootstrap stage before any sensor task can start.
     */
    ESP_ERROR_CHECK(initialize_platform_once());

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
