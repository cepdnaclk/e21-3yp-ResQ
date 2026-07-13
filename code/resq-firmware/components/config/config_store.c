#include "config_store.h"
#include <limits.h>
#include <stdio.h>
#include <string.h>

#include "esp_mac.h"
#include "nvs.h"
#include "nvs_flash.h"

/* NVS namespace for ResQ config */
#define RESQ_NVS_NAMESPACE "resq_cfg"

/* Network config NVS keys */
#define NVS_KEY_WIFI_SSID      "wifi_ssid"
#define NVS_KEY_WIFI_PASS      "wifi_pass"

#define NVS_KEY_REGISTER_URL   "reg_url"
#define NVS_KEY_BACKEND_BASE_URL "backend_url"

#define NVS_KEY_MQTT_HOST      "mqtt_host" /* legacy */
#define NVS_KEY_MQTT_PORT      "mqtt_port" /* legacy */
#define NVS_KEY_BACKEND_REGISTERED "backend_reg" /* legacy */

#define NVS_KEY_DEVICE_MAC     "dev_mac" /* legacy */
#define NVS_KEY_DEVICE_ID      "dev_id" /* legacy */

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

/* Additional adaptive calibration NVS keys */
#define NVS_KEY_PROFILE_ID          "profile_id"
#define NVS_KEY_HALL_NOISE          "hall_noise"
#define NVS_KEY_HALL_DIRECTION      "hall_dir"
#define NVS_KEY_HALL_RANGE          "hall_range"
#define NVS_KEY_HALL_START_DELTA    "hall_start"
#define NVS_KEY_HALL_FULL_DELTA     "hall_full_delta"
#define NVS_KEY_HALL_RECOIL         "hall_recoil"
#define NVS_KEY_HALL_TOLERANCE      "hall_tol"

#define NVS_KEY_PRESSURE0_BASE      "p0_base"
#define NVS_KEY_PRESSURE1_BASE      "p1_base"
#define NVS_KEY_PRESSURE2_BASE      "p2_base"
#define NVS_KEY_PRESSURE0_KPA_SCALE "p0_kpa_scale"
#define NVS_KEY_PRESSURE1_KPA_SCALE "p1_kpa_scale"
#define NVS_KEY_PRESSURE2_KPA_SCALE "p2_kpa_scale"

#define NVS_KEY_PRESSURE0_NOISE     "p0_noise"
#define NVS_KEY_PRESSURE1_NOISE     "p1_noise"
#define NVS_KEY_PRESSURE2_NOISE     "p2_noise"

#define NVS_KEY_PRESSURE1_RANGE     "p1_range"
#define NVS_KEY_PRESSURE2_RANGE     "p2_range"

#define NVS_KEY_PRESSURE_CONTACT    "p_contact"
#define NVS_KEY_PRESSURE_VALID      "p_valid"
#define NVS_KEY_PRESSURE_BALANCE_PCT "p_balance_pct"
#define NVS_KEY_PRESSURE_MODE       "p_mode"
#define NVS_KEY_PRESSURE_DEGRADED   "p_degraded"
#define NVS_KEY_USING_LAST_PRESSURE "p_last_ok"
#define NVS_KEY_PRESSURE_OK         "p_ok"
#define NVS_KEY_HALL_OK             "hall_ok"
#define NVS_KEY_FULL_DEPTH_MM       "full_depth_mm"

#define SENSOR_CONVERSION_KPA_SCALE_FACTOR 1000000000
#define SENSOR_CONVERSION_MM_SCALE_FACTOR 1000

#define NVS_KEY_CAL_SAMPLES         "cal_samples"
#define NVS_KEY_CAL_WINDOW_MS       "cal_window_ms"
#define NVS_KEY_CALIBRATED_AT_MS    "calibrated_at"

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

static void nvs_get_scaled_float_safe(nvs_handle_t handle,
                                      const char *key,
                                      int32_t scale_factor,
                                      float *out_value)
{
    if (out_value == NULL) {
        return;
    }

    int32_t stored = 0;
    if (scale_factor > 0 && nvs_get_i32(handle, key, &stored) == ESP_OK) {
        *out_value = (float)stored / (float)scale_factor;
    }
}

static esp_err_t nvs_set_scaled_float_safe(nvs_handle_t handle,
                                           const char *key,
                                           int32_t scale_factor,
                                           float value)
{
    if (scale_factor <= 0) {
        return ESP_ERR_INVALID_ARG;
    }

    double scaled = (double)value * (double)scale_factor;
    if (scaled > (double)INT32_MAX || scaled < (double)INT32_MIN) {
        return ESP_ERR_INVALID_ARG;
    }

    int32_t stored = (int32_t)(scaled >= 0.0 ? scaled + 0.5 : scaled - 0.5);
    return nvs_set_i32(handle, key, stored);
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

    /* Try new backend_base_url key first; fall back to legacy register_url */
    nvs_get_string_safe(handle,
                        NVS_KEY_BACKEND_BASE_URL,
                        config->backend_base_url,
                        sizeof(config->backend_base_url));

    if (config->backend_base_url[0] == '\0') {
        nvs_get_string_safe(handle,
                            NVS_KEY_REGISTER_URL,
                            config->backend_base_url,
                            sizeof(config->backend_base_url));
    }


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
    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    err = nvs_set_str(handle, NVS_KEY_WIFI_SSID, config->wifi_ssid);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_WIFI_PASS, config->wifi_pass);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_BACKEND_BASE_URL, config->backend_base_url);
    if (err != ESP_OK) goto exit;

    /* Erase legacy keys to avoid stale backend-derived values */
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_BACKEND_REGISTERED);
    nvs_erase_key(handle, NVS_KEY_DEVICE_ID);
    nvs_erase_key(handle, NVS_KEY_REGISTER_URL);

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

    /* adaptive fields (optional) */
    {
        size_t _req = sizeof(config->profile_id);
        nvs_get_str(handle, NVS_KEY_PROFILE_ID, config->profile_id, &_req);
    }
    nvs_get_i32(handle, NVS_KEY_HALL_NOISE, &config->hall_noise_raw);
    nvs_get_i32(handle, NVS_KEY_HALL_DIRECTION, &config->hall_direction);
    nvs_get_i32(handle, NVS_KEY_HALL_RANGE, &config->hall_range_raw);
    nvs_get_i32(handle, NVS_KEY_HALL_START_DELTA, &config->hall_start_delta);
    nvs_get_i32(handle, NVS_KEY_HALL_FULL_DELTA, &config->hall_full_delta_threshold);
    nvs_get_i32(handle, NVS_KEY_HALL_RECOIL, &config->hall_recoil_delta);
    nvs_get_i32(handle, NVS_KEY_HALL_TOLERANCE, &config->hall_tolerance_raw);

    nvs_get_i32(handle, NVS_KEY_REF_PRESSURE, &config->ref_pressure);

    nvs_get_i32(handle, NVS_KEY_BLADDER1_PRESSURE, &config->bladder_1_pressure);
    nvs_get_i32(handle, NVS_KEY_BLADDER2_PRESSURE, &config->bladder_2_pressure);

    nvs_get_i32(handle, NVS_KEY_BLADDER1_FULL, &config->bladder_1_full_press);
    nvs_get_i32(handle, NVS_KEY_BLADDER2_FULL, &config->bladder_2_full_press);

    nvs_get_i32(handle, NVS_KEY_PRESSURE0_BASE, &config->pressure_0_baseline);
    nvs_get_i32(handle, NVS_KEY_PRESSURE1_BASE, &config->pressure_1_baseline);
    nvs_get_i32(handle, NVS_KEY_PRESSURE2_BASE, &config->pressure_2_baseline);
    nvs_get_scaled_float_safe(handle, NVS_KEY_PRESSURE0_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, &config->pressure_0_kpa_per_count);
    nvs_get_scaled_float_safe(handle, NVS_KEY_PRESSURE1_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, &config->pressure_1_kpa_per_count);
    nvs_get_scaled_float_safe(handle, NVS_KEY_PRESSURE2_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, &config->pressure_2_kpa_per_count);

    nvs_get_i32(handle, NVS_KEY_PRESSURE0_NOISE, &config->pressure_0_noise_raw);
    nvs_get_i32(handle, NVS_KEY_PRESSURE1_NOISE, &config->pressure_1_noise_raw);
    nvs_get_i32(handle, NVS_KEY_PRESSURE2_NOISE, &config->pressure_2_noise_raw);

    nvs_get_i32(handle, NVS_KEY_PRESSURE1_RANGE, &config->pressure_1_range_raw);
    nvs_get_i32(handle, NVS_KEY_PRESSURE2_RANGE, &config->pressure_2_range_raw);

    nvs_get_i32(handle, NVS_KEY_PRESSURE_CONTACT, &config->pressure_contact_threshold);
    nvs_get_i32(handle, NVS_KEY_PRESSURE_VALID, &config->pressure_valid_threshold);
    nvs_get_i32(handle, NVS_KEY_PRESSURE_BALANCE_PCT, &config->pressure_balance_allowed_pct);
    {
        int32_t pressure_mode = config->pressure_mode;
        if (nvs_get_i32(handle, NVS_KEY_PRESSURE_MODE, &pressure_mode) == ESP_OK &&
            pressure_mode >= CALIBRATION_PRESSURE_REQUIRED &&
            pressure_mode <= CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE) {
            config->pressure_mode = (calibration_pressure_mode_t)pressure_mode;
        }
    }
    {
        uint8_t flag = 0;
        if (nvs_get_u8(handle, NVS_KEY_PRESSURE_DEGRADED, &flag) == ESP_OK) {
            config->pressure_degraded = flag ? true : false;
        }
        if (nvs_get_u8(handle, NVS_KEY_USING_LAST_PRESSURE, &flag) == ESP_OK) {
            config->using_last_stable_pressure = flag ? true : false;
        }
        if (nvs_get_u8(handle, NVS_KEY_PRESSURE_OK, &flag) == ESP_OK) {
            config->pressure_valid = flag ? true : false;
        }
        if (nvs_get_u8(handle, NVS_KEY_HALL_OK, &flag) == ESP_OK) {
            config->hall_valid = flag ? true : false;
        }
    }
    nvs_get_scaled_float_safe(handle, NVS_KEY_FULL_DEPTH_MM, SENSOR_CONVERSION_MM_SCALE_FACTOR, &config->full_depth_mm);

    nvs_get_i32(handle, NVS_KEY_CAL_SAMPLES, &config->calibration_sample_count);
    nvs_get_i32(handle, NVS_KEY_CAL_WINDOW_MS, &config->calibration_window_ms);

    int64_t tmp64 = 0;
    nvs_get_i64(handle, NVS_KEY_CALIBRATED_AT_MS, &tmp64);
    config->calibrated_at_ms = tmp64;

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

    /* adaptive fields */
    err = nvs_set_str(handle, NVS_KEY_PROFILE_ID, config->profile_id);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_HALL_NOISE, config->hall_noise_raw);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_DIRECTION, config->hall_direction);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_RANGE, config->hall_range_raw);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_START_DELTA, config->hall_start_delta);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_FULL_DELTA, config->hall_full_delta_threshold);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_RECOIL, config->hall_recoil_delta);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_HALL_TOLERANCE, config->hall_tolerance_raw);
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

    err = nvs_set_i32(handle, NVS_KEY_PRESSURE0_BASE, config->pressure_0_baseline);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE1_BASE, config->pressure_1_baseline);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE2_BASE, config->pressure_2_baseline);
    if (err != ESP_OK) goto exit;
    err = nvs_set_scaled_float_safe(handle, NVS_KEY_PRESSURE0_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, config->pressure_0_kpa_per_count);
    if (err != ESP_OK) goto exit;
    err = nvs_set_scaled_float_safe(handle, NVS_KEY_PRESSURE1_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, config->pressure_1_kpa_per_count);
    if (err != ESP_OK) goto exit;
    err = nvs_set_scaled_float_safe(handle, NVS_KEY_PRESSURE2_KPA_SCALE, SENSOR_CONVERSION_KPA_SCALE_FACTOR, config->pressure_2_kpa_per_count);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_PRESSURE0_NOISE, config->pressure_0_noise_raw);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE1_NOISE, config->pressure_1_noise_raw);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE2_NOISE, config->pressure_2_noise_raw);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_PRESSURE1_RANGE, config->pressure_1_range_raw);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE2_RANGE, config->pressure_2_range_raw);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_PRESSURE_CONTACT, config->pressure_contact_threshold);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE_VALID, config->pressure_valid_threshold);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE_BALANCE_PCT, config->pressure_balance_allowed_pct);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_PRESSURE_MODE, (int32_t)config->pressure_mode);
    if (err != ESP_OK) goto exit;
    err = nvs_set_u8(handle, NVS_KEY_PRESSURE_DEGRADED, config->pressure_degraded ? 1 : 0);
    if (err != ESP_OK) goto exit;
    err = nvs_set_u8(handle, NVS_KEY_USING_LAST_PRESSURE, config->using_last_stable_pressure ? 1 : 0);
    if (err != ESP_OK) goto exit;
    err = nvs_set_u8(handle, NVS_KEY_PRESSURE_OK, config->pressure_valid ? 1 : 0);
    if (err != ESP_OK) goto exit;
    err = nvs_set_u8(handle, NVS_KEY_HALL_OK, config->hall_valid ? 1 : 0);
    if (err != ESP_OK) goto exit;
    err = nvs_set_scaled_float_safe(handle, NVS_KEY_FULL_DEPTH_MM, SENSOR_CONVERSION_MM_SCALE_FACTOR, config->full_depth_mm);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i32(handle, NVS_KEY_CAL_SAMPLES, config->calibration_sample_count);
    if (err != ESP_OK) goto exit;
    err = nvs_set_i32(handle, NVS_KEY_CAL_WINDOW_MS, config->calibration_window_ms);
    if (err != ESP_OK) goto exit;

    err = nvs_set_i64(handle, NVS_KEY_CALIBRATED_AT_MS, config->calibrated_at_ms);
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
    nvs_erase_key(handle, NVS_KEY_BACKEND_BASE_URL);
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_BACKEND_REGISTERED);
    /* Do NOT erase device MAC here. Keep device_id handling as-is. */
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

    /* erase adaptive fields */
    nvs_erase_key(handle, NVS_KEY_PROFILE_ID);
    nvs_erase_key(handle, NVS_KEY_HALL_NOISE);
    nvs_erase_key(handle, NVS_KEY_HALL_DIRECTION);
    nvs_erase_key(handle, NVS_KEY_HALL_RANGE);
    nvs_erase_key(handle, NVS_KEY_HALL_START_DELTA);
    nvs_erase_key(handle, NVS_KEY_HALL_FULL_DELTA);
    nvs_erase_key(handle, NVS_KEY_HALL_RECOIL);
    nvs_erase_key(handle, NVS_KEY_HALL_TOLERANCE);

    nvs_erase_key(handle, NVS_KEY_PRESSURE0_BASE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE1_BASE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE2_BASE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE0_KPA_SCALE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE1_KPA_SCALE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE2_KPA_SCALE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE0_NOISE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE1_NOISE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE2_NOISE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE1_RANGE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE2_RANGE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_CONTACT);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_VALID);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_BALANCE_PCT);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_MODE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_DEGRADED);
    nvs_erase_key(handle, NVS_KEY_USING_LAST_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_PRESSURE_OK);
    nvs_erase_key(handle, NVS_KEY_HALL_OK);
    nvs_erase_key(handle, NVS_KEY_CAL_SAMPLES);
    nvs_erase_key(handle, NVS_KEY_CAL_WINDOW_MS);
    nvs_erase_key(handle, NVS_KEY_CALIBRATED_AT_MS);
    nvs_erase_key(handle, NVS_KEY_FULL_DEPTH_MM);

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
