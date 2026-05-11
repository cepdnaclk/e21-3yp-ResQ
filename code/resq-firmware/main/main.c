#include <stdio.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cJSON.h"

#include "config_store.h"
#include "health_monitor.h"
#include "mqtt_manager.h"
#include "provision_ap.h"
#include "register_client.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "telemetry_publisher.h"
#include "event_publisher.h"
#include "wifi_manager.h"
#include "fault_reporter.h"
#include "command_handler.h"
#include "device_control.h"
#include "esp_system.h"
#include "queued_publisher.h"
#include "recovery_manager.h"
#include "factory_reset.h"
#include "device_identity.h"
#include "resq_protocol.h"
#include "status_indicator.h"
#include "calibration_manager.h"

static const char *TAG = "main";

static esp_err_t main_command_handle_cb(
    const char *suffix,
    const char *payload,
    void *ctx
)
{
    (void)ctx;
    return command_handler_handle_message(suffix, payload);
}

static esp_err_t main_command_reject_cb(
    const char *suffix,
    const char *reason,
    void *ctx
)
{
    (void)ctx;
    return command_handler_reject_message(suffix, reason);
}

static bool main_loop_may_set_idle_indicator(indicator_state_t state)
{
    switch (state) {
        case INDICATOR_STATE_CALIBRATING:
        case INDICATOR_STATE_READY_FOR_SESSION:
        case INDICATOR_STATE_CALIBRATION_FAIL:
        case INDICATOR_STATE_SESSION_ACTIVE:
        case INDICATOR_STATE_SESSION_INTERRUPTED:
        case INDICATOR_STATE_FAULT:
        case INDICATOR_STATE_RESETTING:
            return false;

        default:
            return true;
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "ResQ firmware boot - Step 8");

    /* -------------------------------------------------
     * Initialize persistent config storage
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(config_store_init());
    ESP_ERROR_CHECK(factory_reset_init());

    ESP_ERROR_CHECK(status_indicator_init());
    ESP_ERROR_CHECK(status_indicator_start());
    status_indicator_set(INDICATOR_STATE_WIFI_CONNECTING);

    /* Hardware-triggered factory reset path */
    if (factory_reset_button_held(pdMS_TO_TICKS(5000))) {
        ESP_LOGW(TAG, "Factory reset requested by hardware button");
        ESP_ERROR_CHECK(config_store_clear());
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
    }

    device_config_t cfg;
    ESP_ERROR_CHECK(config_store_load(&cfg));

    /* Boot-time config validation */
    if (!factory_reset_config_valid(&cfg)) {
        ESP_LOGW(TAG, "Stored config is invalid, clearing and falling back to provisioning");
        ESP_ERROR_CHECK(config_store_clear());
        ESP_ERROR_CHECK(config_store_load(&cfg));
    }

    /* -------------------------------------------------
     * Initialize sensor layer only.
     * DO NOT start sensor task here.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(sensor_runtime_init(&cfg));
    session_manager_init();
    ESP_ERROR_CHECK(calibration_manager_init(&cfg));

    /* -------------------------------------------------
     * Provisioning flow
     * If device is not provisioned, start AP mode and
     * wait for QR-based provisioning data.
     * ------------------------------------------------- */
    if (!cfg.provisioned) {
        ESP_LOGW(TAG, "Device is not provisioned yet");
        status_indicator_set(INDICATOR_STATE_PROVISIONING);

        ESP_ERROR_CHECK(provisioning_start());
        ESP_ERROR_CHECK(provisioning_wait_for_config(&cfg, portMAX_DELAY));
        ESP_ERROR_CHECK(provisioning_stop());

        status_indicator_set(INDICATOR_STATE_WIFI_CONNECTING);
    }

    /* -------------------------------------------------
     * Connect to Local Hub Wi-Fi
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(wifi_manager_init());
    ESP_ERROR_CHECK(wifi_manager_connect_sta(
        cfg.wifi_ssid,
        cfg.wifi_pass,
        pdMS_TO_TICKS(30000)
    ));

    /* -------------------------------------------------
     * Register device with backend
     * ------------------------------------------------- */
    register_result_t reg = {0};
    bool registration_ok = false;
    int registration_failures = 0;
    bool used_register_url_mqtt_fallback = false;

    while (1) {
        esp_err_t reg_err = register_client_send(&cfg, &reg);
        if (reg_err == ESP_OK) {
            registration_ok = true;
            break;
        }

        registration_failures++;

        bool have_cached_runtime =
            (cfg.device_id[0] != '\0') &&
            (cfg.manikin_id[0] != '\0') &&
            (cfg.mqtt_host[0] != '\0') &&
            (cfg.mqtt_port > 0);

        if (have_cached_runtime && registration_failures >= 3) {
            char derived_host[64] = {0};
            if (derive_host_from_url(cfg.register_url, derived_host, sizeof(derived_host))) {
                snprintf(cfg.mqtt_host, sizeof(cfg.mqtt_host), "%s", derived_host);
                cfg.mqtt_port = 1883;
                used_register_url_mqtt_fallback = true;
                ESP_LOGW(
                    TAG,
                    "Registration unavailable (%s). Using MQTT fallback derived from register_url: %s:%d",
                    esp_err_to_name(reg_err),
                    cfg.mqtt_host,
                    cfg.mqtt_port
                );
            } else {
                ESP_LOGW(
                    TAG,
                    "Registration unavailable (%s). Continuing with cached runtime config.",
                    esp_err_to_name(reg_err)
                );
            }
            break;
        }

        ESP_LOGW(
            TAG,
            "Registration failed: %s. Retrying in 3 seconds...",
            esp_err_to_name(reg_err)
        );
        vTaskDelay(pdMS_TO_TICKS(3000));
    }

    if (registration_ok && !reg.ok) {
        ESP_LOGE(TAG, "Backend rejected registration");
        while (1) {
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }

    /* -------------------------------------------------
     * Merge backend-assigned runtime values into config
     * and save once to NVS
     * ------------------------------------------------- */
    if (registration_ok && reg.assigned_device_id[0] != '\0') {
        snprintf(cfg.device_id, sizeof(cfg.device_id), "%s", reg.assigned_device_id);
    }

    if (registration_ok && reg.mqtt_host[0] != '\0') {
        snprintf(cfg.mqtt_host, sizeof(cfg.mqtt_host), "%s", reg.mqtt_host);
    }

    if (registration_ok && reg.mqtt_port > 0) {
        cfg.mqtt_port = reg.mqtt_port;
    }

    ESP_ERROR_CHECK(config_store_save(&cfg));
    if (registration_ok) {
        ESP_LOGI(TAG, "Updated runtime config saved after registration");
    } else if (used_register_url_mqtt_fallback) {
        ESP_LOGW(TAG, "Runtime config saved with MQTT fallback endpoint %s:%d", cfg.mqtt_host, cfg.mqtt_port);
    } else {
        ESP_LOGW(TAG, "Runtime config saved without registration update (using cached values)");
    }

    ESP_LOGI(TAG, "Active runtime endpoint: mqtt=%s:%d register=%s", cfg.mqtt_host, cfg.mqtt_port, cfg.register_url);

    /* -------------------------------------------------
     * Initialize runtime modules that cache config
     * only after final backend-assigned config is ready
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(command_handler_init(&cfg));
    ESP_ERROR_CHECK(device_control_init(&cfg));

    ESP_LOGI(TAG, "Command handler and device control initialized with final config");
    
    /* -------------------------------------------------
     * Initialize device identity using final assigned IDs
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(device_identity_init(cfg.device_id));

    device_identity_info_t ident;
    ESP_ERROR_CHECK(device_identity_get(&ident));

    ESP_LOGI(TAG, "Device identity initialized");
    ESP_LOGI(TAG, "  device_id        : %s", ident.device_id);
    
    ESP_LOGI(TAG, "  firmware_version : %s", ident.firmware_version);
    ESP_LOGI(TAG, "  hardware_revision: %s", ident.hardware_revision);
    ESP_LOGI(TAG, "  chip_model       : %s", ident.chip_model);
    ESP_LOGI(TAG, "  mac_address      : %s", ident.mac_address);
    ESP_LOGI(TAG, "  reset_reason     : %d", ident.reset_reason);

    /* -------------------------------------------------
     * Start MQTT control channel
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(mqtt_manager_init(&cfg));
    ESP_ERROR_CHECK(queued_publisher_init());
    ESP_ERROR_CHECK(event_publisher_init(&cfg));
    ESP_ERROR_CHECK(mqtt_manager_set_command_callbacks(
        main_command_handle_cb,
        main_command_reject_cb,
        NULL
    ));
    ESP_ERROR_CHECK(mqtt_manager_start());

    /* -------------------------------------------------
     * Start queued publisher
     * Handles buffered/outbound messages that should be
     * retried or sent asynchronously.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(queued_publisher_start());

    ESP_LOGI(TAG, "Queued publisher started");

    /* -------------------------------------------------
     * Publish one identity event after MQTT + queue are ready
     * ------------------------------------------------- */
    char *identity_payload = resq_payload_identity_event(
        "device_identity",
        ident.device_id,
        ident.firmware_version,
        ident.hardware_revision,
        ident.build_date,
        ident.build_time,
        ident.chip_model,
        ident.chip_cores,
        ident.chip_revision,
        ident.mac_address,
        ident.reset_reason
    );

    if (identity_payload) {
        queued_publisher_publish_or_queue(RESQ_SUFFIX_EVENTS, identity_payload, 1, 0);
        cJSON_free(identity_payload);
    }

    /* Publish retained status now that MQTT and publishers are initialized */
    esp_err_t st_err = event_publisher_publish_status(RESQ_STATE_ONLINE_IDLE, false, "");
    if (st_err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to publish initial status: %s", esp_err_to_name(st_err));
    }

    status_indicator_set(INDICATOR_STATE_ONLINE_IDLE);

    /* -------------------------------------------------
     * Start telemetry publisher
     * Telemetry is only sent during active sessions.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(telemetry_publisher_init(&cfg));
    ESP_ERROR_CHECK(telemetry_publisher_start());

    ESP_LOGI(TAG, "Telemetry publisher started");
    ESP_LOGI(TAG, "Telemetry will only be sent during active sessions");

    /* -------------------------------------------------
     * Start health monitor
     * Heartbeat/status reporting stays active even when
     * no session is running.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(health_monitor_init(&cfg));
    ESP_ERROR_CHECK(health_monitor_start());

    ESP_LOGI(TAG, "Health monitor started");
    ESP_LOGI(TAG, "Heartbeat/status reporting enabled");

    /* -------------------------------------------------
     * Start fault reporter
     * Publishes sensor fault/recovery events when:
     *  - MQTT is connected
     *  - a session is active
     *  - sensor runtime is running
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(fault_reporter_init(&cfg));
    ESP_ERROR_CHECK(fault_reporter_start());

    ESP_LOGI(TAG, "Fault reporter started");

    /* -------------------------------------------------
     * Start recovery manager
     * Monitors connectivity/runtime health and triggers
     * recovery actions when critical links fail.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(recovery_manager_init(&cfg));
    ESP_ERROR_CHECK(recovery_manager_start());

    /* Recovery policy:
     * If Wi-Fi or MQTT drops during an active session,
     * the session is forcefully aborted to keep state
     * consistent and avoid publishing invalid data.
     */
    ESP_LOGI(TAG, "Recovery manager started");
    ESP_LOGI(TAG, "Active sessions will be aborted if Wi-Fi or MQTT is lost");

    /* -------------------------------------------------
     * Idle loop
     * Sensor task is started/stopped by MQTT session
     * commands, not from here.
     * ------------------------------------------------- */
    ESP_LOGI(TAG, "Device is now idle and waiting for session commands");
    ESP_LOGI(TAG, "Sensors will NOT run until session/start is received");

    /* Track top-level device state so we only log on transitions. */
    enum {
        DEVICE_ST_UNKNOWN = -1,
        DEVICE_ST_SESSION_ACTIVE = 0,
        DEVICE_ST_ONLINE_IDLE = 1,
        DEVICE_ST_WIFI_CONNECTING = 2
    };

    int s_last_device_state = DEVICE_ST_UNKNOWN;

    while (1) {
        device_action_t action = device_control_get_pending_action();

        if (action == DEVICE_ACTION_REBOOT) {
            status_indicator_set(INDICATOR_STATE_RESETTING);
            ESP_LOGW(TAG, "Applying pending reboot action");
            sensor_runtime_stop();
            session_manager_stop();
            device_control_clear_pending_action();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        }

        if (action == DEVICE_ACTION_UNPAIR_REBOOT) {
            status_indicator_set(INDICATOR_STATE_RESETTING);
            ESP_LOGW(TAG, "Applying pending unpair action");
            sensor_runtime_stop();
            session_manager_stop();
            ESP_ERROR_CHECK(config_store_clear());
            device_control_clear_pending_action();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        }

        /* Determine the current top-level state */
        int cur_state;
        if (session_manager_is_active()) {
            cur_state = DEVICE_ST_SESSION_ACTIVE;
        } else if (wifi_manager_is_connected() && mqtt_manager_is_connected()) {
            cur_state = DEVICE_ST_ONLINE_IDLE;
        } else {
            cur_state = DEVICE_ST_WIFI_CONNECTING;
        }

        /* Only log / set indicators when the observed state changes */
        if (cur_state != s_last_device_state) {
            if (cur_state == DEVICE_ST_SESSION_ACTIVE) {
                status_indicator_set(INDICATOR_STATE_SESSION_ACTIVE);
                char session_id[64] = {0};
                session_manager_get_session_id(session_id, sizeof(session_id));
                ESP_LOGI(TAG, "Session active: %s", session_id);
            } else if (cur_state == DEVICE_ST_ONLINE_IDLE) {
                if (main_loop_may_set_idle_indicator(status_indicator_get())) {
                    status_indicator_set(INDICATOR_STATE_ONLINE_IDLE);
                }
                ESP_LOGI(TAG, "Idle - waiting for Local Hub commands");
            } else {
                if (main_loop_may_set_idle_indicator(status_indicator_get())) {
                    status_indicator_set(INDICATOR_STATE_WIFI_CONNECTING);
                }
                ESP_LOGW(TAG, "Waiting for connectivity recovery");
            }

            s_last_device_state = cur_state;
        }

        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}
