#include "config_store.h"

#include <string.h>

#include "nvs.h"
#include "nvs_flash.h"

/* Namespace used inside NVS */
#define CONFIG_NAMESPACE "resq_cfg"

/* NVS keys */
#define KEY_WIFI_SSID   "wifi_ssid"
#define KEY_WIFI_PASS   "wifi_pass"
#define KEY_REG_URL     "reg_url"
#define KEY_MQTT_HOST   "mqtt_host"
#define KEY_MQTT_PORT   "mqtt_port"
#define KEY_DEVICE_ID   "device_id"
#define KEY_MANIKIN_ID  "manikin_id"
#define KEY_AUTH_TOKEN  "auth_token"
#define KEY_PROVISIONED "prov"

static esp_err_t save_str(nvs_handle_t handle, const char *key, const char *value)
{
    return nvs_set_str(handle, key, (value != NULL) ? value : "");
}

static void load_str_or_empty(nvs_handle_t handle, const char *key, char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return;
    }

    size_t required_len = out_len;
    esp_err_t err = nvs_get_str(handle, key, out, &required_len);

    if (err != ESP_OK) {
        out[0] = '\0';
    }
}

esp_err_t config_store_init(void)
{
    esp_err_t err = nvs_flash_init();

    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        err = nvs_flash_erase();
        if (err != ESP_OK) {
            return err;
        }
        err = nvs_flash_init();
    }

    return err;
}

esp_err_t config_store_load(device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(cfg, 0, sizeof(*cfg));

    /* Sensible default before reading */
    cfg->mqtt_port = 1883;
    cfg->provisioned = false;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    load_str_or_empty(handle, KEY_WIFI_SSID,  cfg->wifi_ssid,   sizeof(cfg->wifi_ssid));
    load_str_or_empty(handle, KEY_WIFI_PASS,  cfg->wifi_pass,   sizeof(cfg->wifi_pass));
    load_str_or_empty(handle, KEY_REG_URL,    cfg->register_url, sizeof(cfg->register_url));
    load_str_or_empty(handle, KEY_MQTT_HOST,  cfg->mqtt_host,   sizeof(cfg->mqtt_host));
    load_str_or_empty(handle, KEY_DEVICE_ID,  cfg->device_id,   sizeof(cfg->device_id));
    load_str_or_empty(handle, KEY_MANIKIN_ID, cfg->manikin_id,  sizeof(cfg->manikin_id));
    load_str_or_empty(handle, KEY_AUTH_TOKEN, cfg->auth_token,  sizeof(cfg->auth_token));

    uint16_t mqtt_port = 1883;
    if (nvs_get_u16(handle, KEY_MQTT_PORT, &mqtt_port) == ESP_OK) {
        cfg->mqtt_port = (int)mqtt_port;
    }

    uint8_t provisioned = 0;
    if (nvs_get_u8(handle, KEY_PROVISIONED, &provisioned) == ESP_OK) {
        cfg->provisioned = (provisioned == 1);
    }

    nvs_close(handle);
    return ESP_OK;
}

esp_err_t config_store_save(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = save_str(handle, KEY_WIFI_SSID, cfg->wifi_ssid);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_WIFI_PASS, cfg->wifi_pass);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_REG_URL, cfg->register_url);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_MQTT_HOST, cfg->mqtt_host);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_DEVICE_ID, cfg->device_id);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_MANIKIN_ID, cfg->manikin_id);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_AUTH_TOKEN, cfg->auth_token);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u16(handle, KEY_MQTT_PORT, (uint16_t)cfg->mqtt_port);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u8(handle, KEY_PROVISIONED, cfg->provisioned ? 1 : 0);
    if (err != ESP_OK) goto cleanup;

    err = nvs_commit(handle);

cleanup:
    nvs_close(handle);
    return err;
}

esp_err_t config_store_clear(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_erase_all(handle);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }

    nvs_close(handle);
    return err;
}

bool config_store_is_provisioned(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return false;
    }

    uint8_t provisioned = 0;
    err = nvs_get_u8(handle, KEY_PROVISIONED, &provisioned);

    nvs_close(handle);

    if (err != ESP_OK) {
        return false;
    }

    return (provisioned == 1);
}