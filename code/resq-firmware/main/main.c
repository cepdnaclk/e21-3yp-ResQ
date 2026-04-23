#include <stdio.h>

#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "config_store.h"
#include "health_monitor.h"
#include "mqtt_manager.h"
#include "provision_ap.h"
#include "register_client.h"
#include "sensor_runtime.h"
#include "session_manager.h"
#include "telemetry_publisher.h"
#include "wifi_manager.h"
#include "fault_reporter.h"
#include "command_handler.h"
#include "device_control.h"
#include "esp_system.h"
#include "queued_publisher.h"

static const char *TAG = "main";

void app_main(void)
{
    ESP_LOGI(TAG, "ResQ firmware boot - Step 8");

    /* -------------------------------------------------
     * Initialize persistent config storage
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(config_store_init());

    device_config_t cfg;
    ESP_ERROR_CHECK(config_store_load(&cfg));

    /* -------------------------------------------------
     * Initialize sensor layer only.
     * DO NOT start sensor task here.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(sensor_runtime_init(&cfg));
    session_manager_init();

    /* -------------------------------------------------
     * Initialize command handling
     * Sets up MQTT/control command processing so runtime
     * actions (start/stop session, reboot, unpair, etc.)
     * can be received and routed to the correct modules.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(command_handler_init(&cfg));
    ESP_ERROR_CHECK(device_control_init(&cfg));

    /* -------------------------------------------------
     * Provisioning flow
     * If device is not provisioned, start AP mode and
     * wait for QR-based provisioning data.
     * ------------------------------------------------- */
    if (!cfg.provisioned) {
        ESP_LOGW(TAG, "Device is not provisioned yet");
        ESP_ERROR_CHECK(provisioning_start());
        ESP_ERROR_CHECK(provisioning_wait_for_config(&cfg, portMAX_DELAY));
        ESP_ERROR_CHECK(provisioning_stop());
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
    ESP_ERROR_CHECK(register_client_send(&cfg, &reg));

    if (!reg.ok) {
        ESP_LOGE(TAG, "Backend rejected registration");
        while (1) {
            vTaskDelay(pdMS_TO_TICKS(2000));
        }
    }

    /* -------------------------------------------------
     * Merge backend-assigned values into runtime config
     * ------------------------------------------------- */
    if (reg.assigned_device_id[0] != '\0') {
        snprintf(cfg.device_id, sizeof(cfg.device_id), "%s", reg.assigned_device_id);
    }

    if (reg.assigned_manikin_id[0] != '\0') {
        snprintf(cfg.manikin_id, sizeof(cfg.manikin_id), "%s", reg.assigned_manikin_id);
    }

    if (reg.mqtt_host[0] != '\0') {
        snprintf(cfg.mqtt_host, sizeof(cfg.mqtt_host), "%s", reg.mqtt_host);
    }

    if (reg.mqtt_port > 0) {
        cfg.mqtt_port = reg.mqtt_port;
    }

    ESP_ERROR_CHECK(config_store_save(&cfg));

    /* -------------------------------------------------
     * Start MQTT control channel
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(mqtt_manager_init(&cfg));
    ESP_ERROR_CHECK(mqtt_manager_start());

    /* -------------------------------------------------
     * Start queued publisher
     * Handles buffered/outbound messages that should be
     * retried or sent asynchronously.
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(queued_publisher_init());
    ESP_ERROR_CHECK(queued_publisher_start());

    ESP_LOGI(TAG, "Queued publisher started");

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
     * Idle loop
     * Sensor task is started/stopped by MQTT session
     * commands, not from here.
     * ------------------------------------------------- */
    ESP_LOGI(TAG, "Device is now idle and waiting for session commands");
    ESP_LOGI(TAG, "Sensors will NOT run until session/start is received");

    while (1) {
        device_action_t action = device_control_get_pending_action();

        if (action == DEVICE_ACTION_REBOOT) {
            ESP_LOGW(TAG, "Applying pending reboot action");
            sensor_runtime_stop();
            session_manager_stop();
            device_control_clear_pending_action();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        }

        if (action == DEVICE_ACTION_UNPAIR_REBOOT) {
            ESP_LOGW(TAG, "Applying pending unpair action");
            sensor_runtime_stop();
            session_manager_stop();
            ESP_ERROR_CHECK(config_store_clear());
            device_control_clear_pending_action();
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
        }

        if (session_manager_is_active()) {
            ESP_LOGI(TAG, "Session active: %s", session_manager_get_id());
        } else {
            ESP_LOGI(TAG, "Idle - waiting for Local Hub commands");
        }

        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}