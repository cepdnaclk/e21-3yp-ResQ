#include "error_manager.h"

#include <stdbool.h>
#include <string.h>

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"
#include "config_store.h"
#include "mqtt_manager.h"
#include "runtime_helpers.h"
#include "status_indicator.h"

#ifndef BUTTON_1
#define BUTTON_1 GPIO_NUM_9
#endif

static const char *TAG = "error_manager";
static bool s_initialized = false;

esp_err_t error_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << BUTTON_1,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure BUTTON_1 GPIO: %s", esp_err_to_name(err));
        return err;
    }

    s_initialized = true;
    ESP_LOGI(TAG, "Error manager initialized on BUTTON_1 GPIO=%d", BUTTON_1);

    return ESP_OK;
}

static bool button_is_pressed(void)
{
    return gpio_get_level(BUTTON_1) == 0;
}

static void wait_for_button_press_debounced(void)
{
    ESP_LOGW(TAG, "Waiting for BUTTON_1 press to enter provisioning mode");

    while (true) {
        if (button_is_pressed()) {
            vTaskDelay(pdMS_TO_TICKS(50));

            if (button_is_pressed()) {
                ESP_LOGW(TAG, "BUTTON_1 press confirmed");

                while (button_is_pressed()) {
                    vTaskDelay(pdMS_TO_TICKS(20));
                }

                vTaskDelay(pdMS_TO_TICKS(100));
                return;
            }
        }

        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

resq_state_t error_manager_run(network_config_t *network_config,
                               calibration_config_t *calibration_config,
                               const char *ip_address)
{
    ESP_LOGE(TAG, "Entered ERROR state");

    status_indicator_set_state(RESQ_STATE_ERROR);

    if (mqtt_manager_is_connected() && network_config != NULL) {
        mqtt_manager_publish_status(RESQ_STATE_ERROR,
                                    network_config,
                                    calibration_config,
                                    false,
                                    "",
                                    ip_address != NULL ? ip_address : "");

        runtime_helpers_publish_error_event(network_config,
                                            RESQ_STATE_ERROR,
                                            "FIRMWARE_ERROR_STATE",
                                            "Firmware entered ERROR state. Press BUTTON_1 to reprovision.");
    }

    wait_for_button_press_debounced();

    ESP_LOGW(TAG, "BUTTON_1 pressed. Clearing saved config and returning to PROVISIONING.");

    esp_err_t clear_err = config_store_clear_all();

    if (clear_err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to clear config: %s", esp_err_to_name(clear_err));
    } else {
        ESP_LOGW(TAG, "Stored config cleared");
    }

    if (network_config != NULL) {
        network_config_set_defaults(network_config);
    }

    if (calibration_config != NULL) {
        calibration_config_set_defaults(calibration_config);
    }

    status_indicator_set_state(RESQ_STATE_PROVISIONING);

    return RESQ_STATE_PROVISIONING;
}
