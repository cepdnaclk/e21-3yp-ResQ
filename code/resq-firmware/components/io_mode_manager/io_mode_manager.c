#include "io_mode_manager.h"

#include "config_store.h"
#include "esp_log.h"

static const char *TAG = "io_mode";
static bool s_initialized;
static resq_io_mode_t s_active_mode = RESQ_IO_MODE_SENSOR;

const char *io_mode_to_string(resq_io_mode_t mode)
{
    switch (mode) {
    case RESQ_IO_MODE_USB:
        return "USB";
    case RESQ_IO_MODE_SENSOR:
    default:
        return "SENSOR";
    }
}

esp_err_t io_mode_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    resq_io_mode_t loaded = RESQ_IO_MODE_SENSOR;
    esp_err_t err = config_store_load_io_mode(&loaded);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to load io_mode: %s", esp_err_to_name(err));
        return err;
    }

    s_active_mode = loaded;
    s_initialized = true;
    ESP_LOGI(TAG, "Active hardware I/O mode: %s", io_mode_to_string(loaded));
    return ESP_OK;
}

resq_io_mode_t io_mode_manager_get(void)
{
    return s_active_mode;
}

bool io_mode_manager_is_sensor(void)
{
    return s_active_mode == RESQ_IO_MODE_SENSOR;
}

bool io_mode_manager_is_usb(void)
{
    return s_active_mode == RESQ_IO_MODE_USB;
}

esp_err_t io_mode_manager_request(resq_io_mode_t mode)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }
    if (mode != RESQ_IO_MODE_SENSOR && mode != RESQ_IO_MODE_USB) {
        return ESP_ERR_INVALID_ARG;
    }
    if (mode == s_active_mode) {
        ESP_LOGI(TAG, "I/O mode %s is already active", io_mode_to_string(mode));
        return ESP_OK;
    }

    esp_err_t err = config_store_save_io_mode(mode);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to save requested I/O mode %s: %s",
                 io_mode_to_string(mode), esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "Saved requested I/O mode %s for next boot",
             io_mode_to_string(mode));
    return ESP_OK;
}

void io_mode_manager_set_for_test(resq_io_mode_t mode)
{
    s_active_mode = mode;
    s_initialized = true;
}
