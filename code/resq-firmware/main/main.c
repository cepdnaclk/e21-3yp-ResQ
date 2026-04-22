#include "esp_err.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "config_store.h"
#include "provision_ap.h"
#include "sensor_runtime.h"
#include "wifi_manager.h"

static const char *TAG = "main";

void app_main(void)
{
    ESP_LOGI(TAG, "ResQ firmware boot - Step 3 + Step 4");

    /* -------------------------------------------------
     * Step 2 foundation
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(config_store_init());

    device_config_t cfg;
    ESP_ERROR_CHECK(config_store_load(&cfg));

    /* -------------------------------------------------
     * Step 1 foundation
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(sensor_runtime_init());
    ESP_ERROR_CHECK(sensor_runtime_start());

    /* -------------------------------------------------
     * Step 3
     * If device is not provisioned, start AP mode and
     * wait for QR-based provisioning data.
     * ------------------------------------------------- */
    if (!cfg.provisioned) {
        ESP_LOGW(TAG, "Device is not provisioned yet");
        ESP_LOGI(TAG, "Starting provisioning AP...");

        ESP_ERROR_CHECK(provisioning_start());

        ESP_LOGI(TAG, "Waiting for provisioning data...");
        ESP_LOGI(TAG, "Connect phone to AP and open QR2 URL");

        ESP_ERROR_CHECK(provisioning_wait_for_config(&cfg, portMAX_DELAY));

        ESP_LOGI(TAG, "Provisioning completed successfully");
        ESP_LOGI(TAG, "Stopping provisioning AP...");

        ESP_ERROR_CHECK(provisioning_stop());
    } else {
        ESP_LOGI(TAG, "Stored provisioning found");
        ESP_LOGI(TAG, "  wifi_ssid   : %s", cfg.wifi_ssid);
        ESP_LOGI(TAG, "  register_url: %s", cfg.register_url);
        ESP_LOGI(TAG, "  device_id   : %s", cfg.device_id);
        ESP_LOGI(TAG, "  manikin_id  : %s", cfg.manikin_id);
        ESP_LOGI(TAG, "  mqtt_host   : %s", cfg.mqtt_host);
        ESP_LOGI(TAG, "  mqtt_port   : %d", cfg.mqtt_port);
    }

    /* -------------------------------------------------
     * Step 4
     * Use saved credentials to connect to Local Hub Wi-Fi
     * ------------------------------------------------- */
    ESP_ERROR_CHECK(wifi_manager_init());

    esp_err_t wifi_err = wifi_manager_connect_sta(
        cfg.wifi_ssid,
        cfg.wifi_pass,
        pdMS_TO_TICKS(30000)
    );

    if (wifi_err != ESP_OK) {
        ESP_LOGE(TAG, "Wi-Fi connection failed: %s", esp_err_to_name(wifi_err));
        ESP_LOGE(TAG, "At this stage, stop here and fix Wi-Fi provisioning values");
    } else {
        char ip_str[16] = {0};
        if (wifi_manager_get_ip(ip_str, sizeof(ip_str)) == ESP_OK) {
            ESP_LOGI(TAG, "Device connected to Local Hub Wi-Fi with IP: %s", ip_str);
        }
    }

    /* -------------------------------------------------
     * Keep current sensor supervisor loop for debugging.
     * Later this will be replaced by:
     * - backend registration
     * - MQTT
     * - session management
     * ------------------------------------------------- */
    while (1) {
        sensor_snapshot_t snap;

        if (sensor_runtime_get_latest(&snap) == ESP_OK) {
            ESP_LOGI(
                TAG,
                "F1=%ld (%s) | F2=%ld (%s) | HallRaw=%d | Delta=%d | Count=%d | Feedback=%s | WiFi=%s",
                (long)snap.force1,
                snap.force1_ok ? "OK" : "ERR",
                (long)snap.force2,
                snap.force2_ok ? "OK" : "ERR",
                snap.hall_raw,
                snap.current_delta,
                snap.total_compressions,
                cpr_feedback_to_string(snap.feedback),
                wifi_manager_is_connected() ? "CONNECTED" : "DISCONNECTED"
            );
        } else {
            ESP_LOGW(TAG, "Latest snapshot not available yet");
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}