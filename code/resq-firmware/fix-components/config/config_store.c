#include "config_store.h"

#include <string.h>

#include "nvs.h"
#include "nvs_flash.h"
#include <stdio.h>
#include "esp_mac.h"

/* NVS namespace for ResQ config */
#define RESQ_NVS_NAMESPACE "resq_cfg"

/* Network config NVS keys */
#define NVS_KEY_WIFI_SSID      "wifi_ssid"
#define NVS_KEY_WIFI_PASS      "wifi_pass"

#define NVS_KEY_REGISTER_URL   "reg_url"

#define NVS_KEY_MQTT_HOST      "mqtt_host"
#define NVS_KEY_MQTT_PORT      "mqtt_port"

#define NVS_KEY_DEVICE_MAC     "dev_mac"
#define NVS_KEY_DEVICE_ID      "dev_id"

#define NVS_KEY_PROVISIONED    "provisioned"

/* Calibration NVS keys */
#define NVS_KEY_HALL_BASELINE       "hall_base"
#define NVS_KEY_HALL_DELTA          "hall_delta"
#define NVS_KEY_HALL_FULL_PRESS     "hall_full"

#define NVS_KEY_REF_PRESSURE        "ref_press"
#define NVS_KEY_BLADDER1_PRESSURE   "b1_press"
#define NVS_KEY_BLADDER2_PRESSURE   "b2_press"
#define NVS_KEY_BLADDER1_FULL       "b1_full"
#define NVS_KEY_BLADDER2_FULL       "b2_full"

#define NVS_KEY_CALIBRATED          "calibrated"

/**
 * @brief Open ResQ NVS namespace.
 */
static esp_err_t config_store_open(nvs_open_mode_t mode, nvs_handle_t *handle)
{
    if (handle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    return nvs_open(RESQ_NVS_NAMESPACE, mode, handle);
}

/**
 * @brief Initialize NVS flash.
 *
 * This handles normal ESP-IDF NVS first-boot setup.
 */
esp_err_t config_store_init(void)
{
    esp_err_t err = nvs_flash_init();

    if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
        err == ESP_ERR_NVS_NEW_VERSION_FOUND) {

        err = nvs_flash_erase();
        if (err != ESP_OK) {
            return err;
        }

        err = nvs_flash_init();
    }

    return err;
}

/**
 * @brief Read ESP32-C3 station MAC and format it as a string.
 */
esp_err_t config_store_get_device_mac(char *buffer, size_t buffer_len)
{
    if (buffer == NULL || buffer_len < RESQ_DEVICE_MAC_MAX_LEN) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t mac[6] = {0};

    esp_err_t err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (err != ESP_OK) {
        return err;
    }

    int written = snprintf(buffer,
                           buffer_len,
                           "%02X:%02X:%02X:%02X:%02X:%02X",
                           mac[0],
                           mac[1],
                           mac[2],
                           mac[3],
                           mac[4],
                           mac[5]);

    if (written != 17) {
        buffer[0] = '\0';
        return ESP_FAIL;
    }

    return ESP_OK;
}

/**
 * @brief Apply hardware MAC to network config.
 *
 * This should be called before validating/saving network config.
 */
esp_err_t config_store_apply_device_mac(network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    return config_store_get_device_mac(config->device_mac,
                                       sizeof(config->device_mac));
}

/**
 * @brief Read string from NVS safely.
 */
static esp_err_t nvs_get_string_safe(nvs_handle_t handle,
                                     const char *key,
                                     char *buffer,
                                     size_t buffer_len)
{
    if (buffer == NULL || buffer_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t required_len = buffer_len;
    esp_err_t err = nvs_get_str(handle, key, buffer, &required_len);

    if (err == ESP_ERR_NVS_NOT_FOUND) {
        buffer[0] = '\0';
        return ESP_OK;
    }

    return err;
}

/**
 * @brief Save the hardware MAC to NVS.
 *
 * This is separate because device_mac should survive normal network clear.
 */
static esp_err_t config_store_save_device_mac(nvs_handle_t handle,
                                              const network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    return nvs_set_str(handle,
                       NVS_KEY_DEVICE_MAC,
                       config->device_mac);
}

/**
 * @brief Load network config from NVS.
 */
esp_err_t config_store_load_network(network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    network_config_set_defaults(config);

    esp_err_t mac_err = config_store_apply_device_mac(config);
    if (mac_err != ESP_OK) {
        return mac_err;
    }

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);

    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }

    if (err != ESP_OK) {
        return err;
    }

    nvs_get_string_safe(handle,
                        NVS_KEY_WIFI_SSID,
                        config->wifi_ssid,
                        sizeof(config->wifi_ssid));

    nvs_get_string_safe(handle,
                        NVS_KEY_WIFI_PASS,
                        config->wifi_pass,
                        sizeof(config->wifi_pass));

    nvs_get_string_safe(handle,
                        NVS_KEY_REGISTER_URL,
                        config->register_url,
                        sizeof(config->register_url));

    nvs_get_string_safe(handle,
                        NVS_KEY_MQTT_HOST,
                        config->mqtt_host,
                        sizeof(config->mqtt_host));

    nvs_get_i32(handle,
                NVS_KEY_MQTT_PORT,
                &config->mqtt_port);

    nvs_get_string_safe(handle,
                        NVS_KEY_DEVICE_ID,
                        config->device_id,
                        sizeof(config->device_id));

    uint8_t provisioned = 0;

    nvs_get_u8(handle,
               NVS_KEY_PROVISIONED,
               &provisioned);

    config->provisioned = provisioned ? true : false;

    nvs_close(handle);

    return ESP_OK;
}

/**
 * @brief Save network config to NVS.
 */
esp_err_t config_store_save_network(network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = config_store_apply_device_mac(config);
    if (err != ESP_OK) {
        return err;
    }

    nvs_handle_t handle;
    err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(handle, NVS_KEY_WIFI_SSID, config->wifi_ssid);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_WIFI_PASS, config->wifi_pass);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_REGISTER_URL, config->register_url);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_MQTT_HOST, config->mqtt_host);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_MQTT_PORT, config->mqtt_port);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_DEVICE_ID, config->device_id);
    if (err != ESP_OK) goto exit;

    err = config_store_save_device_mac(handle, config);
    if (err != ESP_OK) goto exit;

    err = nvs_set_u8(handle,
                     NVS_KEY_PROVISIONED,
                     config->provisioned ? 1 : 0);
    if (err != ESP_OK) goto exit;

    err = nvs_commit(handle);

exit:
    nvs_close(handle);
    return err;
}

/**
 * @brief Load calibration config from NVS.
 */
esp_err_t config_store_load_calibration(calibration_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    calibration_config_set_defaults(config);

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);

    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return ESP_OK;
    }

    if (err != ESP_OK) {
        return err;
    }

    nvs_get_i32(handle, NVS_KEY_HALL_BASELINE, &config->hall_baseline);
    nvs_get_i32(handle, NVS_KEY_HALL_DELTA, &config->hall_delta);
    nvs_get_i32(handle, NVS_KEY_HALL_FULL_PRESS, &config->hall_full_press);

    nvs_get_i32(handle, NVS_KEY_REF_PRESSURE, &config->ref_pressure);

    nvs_get_i32(handle, NVS_KEY_BLADDER1_PRESSURE, &config->bladder_1_pressure);
    nvs_get_i32(handle, NVS_KEY_BLADDER2_PRESSURE, &config->bladder_2_pressure);

    nvs_get_i32(handle, NVS_KEY_BLADDER1_FULL, &config->bladder_1_full_press);
    nvs_get_i32(handle, NVS_KEY_BLADDER2_FULL, &config->bladder_2_full_press);

    uint8_t calibrated = 0;
    nvs_get_u8(handle, NVS_KEY_CALIBRATED, &calibrated);
    config->calibrated = calibrated ? true : false;

    nvs_close(handle);
    return ESP_OK;
}

/**
 * @brief Save calibration config to NVS.
 */
esp_err_t config_store_save_calibration(const calibration_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_i32(handle, NVS_KEY_HALL_BASELINE, config->hall_baseline);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_HALL_DELTA, config->hall_delta);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_HALL_FULL_PRESS, config->hall_full_press);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_REF_PRESSURE, config->ref_pressure);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_BLADDER1_PRESSURE, config->bladder_1_pressure);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_BLADDER2_PRESSURE, config->bladder_2_pressure);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_BLADDER1_FULL, config->bladder_1_full_press);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_BLADDER2_FULL, config->bladder_2_full_press);
    if (err != ESP_OK) goto exit;

    err = nvs_set_u8(handle, NVS_KEY_CALIBRATED,
                     config->calibrated ? 1 : 0);
    if (err != ESP_OK) goto exit;

    err = nvs_commit(handle);

exit:
    nvs_close(handle);
    return err;
}

/**
 * @brief Clear network/provisioning values only.
 */
esp_err_t config_store_clear_network(void)
{
    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
    nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
    nvs_erase_key(handle, NVS_KEY_REGISTER_URL);
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_DEVICE_ID);
    nvs_erase_key(handle, NVS_KEY_PROVISIONED);

    err = nvs_commit(handle);
    nvs_close(handle);

    return err;
}

/**
 * @brief Clear calibration values only.
 */
esp_err_t config_store_clear_calibration(void)
{
    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    nvs_erase_key(handle, NVS_KEY_HALL_BASELINE);
    nvs_erase_key(handle, NVS_KEY_HALL_DELTA);
    nvs_erase_key(handle, NVS_KEY_HALL_FULL_PRESS);
    nvs_erase_key(handle, NVS_KEY_REF_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_FULL);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_FULL);
    nvs_erase_key(handle, NVS_KEY_CALIBRATED);

    err = nvs_commit(handle);
    nvs_close(handle);

    return err;
}

/**
 * @brief Clear all ResQ configuration values.
 */
esp_err_t config_store_clear_all(void)
{
    esp_err_t err = config_store_clear_network();
    if (err != ESP_OK) {
        return err;
    }

    err = config_store_clear_calibration();
    if (err != ESP_OK) {
        return err;
    }

    return ESP_OK;
}