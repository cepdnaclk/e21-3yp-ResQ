#include "factory_reset.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define FACTORY_RESET_BUTTON GPIO_NUM_9

static const char *TAG = "factory_reset";

esp_err_t factory_reset_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << FACTORY_RESET_BUTTON),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Factory reset button initialized on GPIO %d", FACTORY_RESET_BUTTON);
    }
    return err;
}

bool factory_reset_button_held(TickType_t hold_time_ticks)
{
    /* Active-low button assumption */
    if (gpio_get_level(FACTORY_RESET_BUTTON) != 0) {
        return false;
    }

    ESP_LOGW(TAG, "Factory reset button pressed, checking hold...");

    TickType_t start = xTaskGetTickCount();

    while ((xTaskGetTickCount() - start) < hold_time_ticks) {
        if (gpio_get_level(FACTORY_RESET_BUTTON) != 0) {
            ESP_LOGI(TAG, "Factory reset button released early");
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }

    ESP_LOGW(TAG, "Factory reset button held long enough");
    return true;
}

bool factory_reset_config_valid(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return false;
    }

    if (!cfg->provisioned) {
        /* unprovisioned config is still a valid state */
        return true;
    }

    if (cfg->wifi_ssid[0] == '\0') {
        return false;
    }

    if (cfg->register_url[0] == '\0') {
        return false;
    }

    if (cfg->mqtt_host[0] == '\0') {
        return false;
    }

    if (cfg->mqtt_port <= 0) {
        return false;
    }

    if (cfg->hall_min_delta <= 0 ||
        cfg->hall_max_delta <= 0 ||
        cfg->compression_start_delta <= 0 ||
        cfg->sensor_sample_interval_ms <= 0) {
        return false;
    }

    return true;
}