#include "device_control.h"

#include <string.h>

#include "esp_log.h"

#include "config_store.h"

static const char *TAG = "device_control";

static device_action_t s_pending_action = DEVICE_ACTION_NONE;
static device_config_t s_cfg;

static bool validate_runtime_config(const device_config_t *cfg)
{
    if (cfg == NULL) {
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

    return true;
}

esp_err_t device_control_init(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *cfg;
    s_pending_action = DEVICE_ACTION_NONE;
    return ESP_OK;
}

esp_err_t device_control_request_reboot(void)
{
    ESP_LOGW(TAG, "Reboot requested");
    s_pending_action = DEVICE_ACTION_REBOOT;
    return ESP_OK;
}

esp_err_t device_control_request_unpair(void)
{
    ESP_LOGW(TAG, "Unpair + reboot requested");
    s_pending_action = DEVICE_ACTION_UNPAIR_REBOOT;
    return ESP_OK;
}

esp_err_t device_control_apply_config_update(const device_config_t *new_cfg)
{
    if (new_cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!validate_runtime_config(new_cfg)) {
        ESP_LOGE(TAG, "Rejected config update: invalid runtime config");
        return ESP_ERR_INVALID_ARG;
    }

    s_cfg = *new_cfg;

    esp_err_t err = config_store_save(&s_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to save updated config: %s", esp_err_to_name(err));
        return err;
    }

    ESP_LOGI(TAG, "Updated config saved");
    return ESP_OK;
}

device_action_t device_control_get_pending_action(void)
{
    return s_pending_action;
}

void device_control_clear_pending_action(void)
{
    s_pending_action = DEVICE_ACTION_NONE;
}