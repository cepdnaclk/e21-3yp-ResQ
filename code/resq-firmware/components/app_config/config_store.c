#include "config_store.h"

#include <string.h>
#include <stdint.h>

#include "esp_log.h"

#include "nvs.h"
#include "nvs_flash.h"

#define CONFIG_NAMESPACE "resq_cfg"

#define KEY_WIFI_SSID    "wifi_ssid"
#define KEY_WIFI_PASS    "wifi_pass"
#define KEY_REG_URL      "reg_url"
#define KEY_MQTT_HOST    "mqtt_host"
#define KEY_MQTT_PORT    "mqtt_port"
#define KEY_DEVICE_ID    "device_id"
#define KEY_AUTH_TOKEN   "auth_token"
#define KEY_PROVISIONED  "prov"

#define KEY_HALL_BASE    "hall_base"
#define KEY_HALL_MIN     "hall_min"
#define KEY_HALL_MAX     "hall_max"
#define KEY_COMP_START   "comp_start"
#define KEY_SAMPLE_MS    "sample_ms"

#define KEY_CAL_PROFILE      "cal_prof"
#define KEY_F1_BASE          "f1_base"
#define KEY_F2_BASE          "f2_base"
#define KEY_F_BASE_TOL       "f_tol_pct"
#define KEY_HALL_TOL         "hall_tol"
#define KEY_PRESS_TOL        "press_tol"
#define KEY_DEPTH_MM         "depth_mm"
#define KEY_DEPTH_DELTA      "depth_delta"
#define KEY_DEPTH_TOL        "depth_tol"
#define KEY_RECOIL_DELTA     "recoil_delta"
#define KEY_IMBALANCE_PCT    "imb_pct"
#define KEY_CAL_WINDOW       "cal_win"
#define KEY_CAL_REQUIRED     "cal_req"
#define KEY_DEBUG_RAW        "dbg_raw"

#define DEFAULT_CAL_PROFILE_ID              "adult-basic-v1"

#define DEFAULT_FORCE1_BASE_REFERENCE       0
#define DEFAULT_FORCE2_BASE_REFERENCE       0
#define DEFAULT_FORCE_BASE_TOLERANCE_PCT    10

#define DEFAULT_NORMAL_HALL_TOLERANCE       80
#define DEFAULT_NORMAL_PRESSURE_TOLERANCE   10000

#define DEFAULT_FULL_DEPTH_TARGET_MM        50
#define DEFAULT_FULL_DEPTH_HALL_DELTA       620
#define DEFAULT_FULL_DEPTH_TOLERANCE_PCT    15

#define DEFAULT_RECOIL_RETURN_DELTA         60
#define DEFAULT_MAX_IMBALANCE_PCT           25

#define DEFAULT_CALIBRATION_WINDOW_MS       3000

#define DEFAULT_CALIBRATION_REQUIRED        true
#define DEFAULT_DEBUG_RAW_ENABLED           false

static const char *TAG = "config_store";


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

static void load_str_or_default(
    nvs_handle_t handle,
    const char *key,
    char *out,
    size_t out_len,
    const char *default_value
) {
    if (out == NULL || out_len == 0) {
        return;
    }

    size_t required_len = out_len;
    esp_err_t err = nvs_get_str(handle, key, out, &required_len);

    if (err != ESP_OK) {
        strncpy(out, default_value, out_len - 1);
        out[out_len - 1] = '\0';
    }
}

static void load_bool_or_default(
    nvs_handle_t handle,
    const char *key,
    bool *out,
    bool default_value
) {
    if (out == NULL) {
        return;
    }

    uint8_t value = default_value ? 1 : 0;

    if (nvs_get_u8(handle, key, &value) == ESP_OK) {
        *out = (value == 1);
    } else {
        *out = default_value;
    }
}

static void load_i32_or_default(
    nvs_handle_t handle,
    const char *key,
    int *out,
    int default_value
)
{
    if (out == NULL) {
        return;
    }

    int32_t value = (int32_t)default_value;

    if (nvs_get_i32(handle, key, &value) == ESP_OK) {
        *out = (int)value;
    } else {
        *out = default_value;
    }
}

static bool is_pct_valid(int value)
{
    return value >= 0 && value <= 100;
}

bool config_store_calibration_values_valid(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return false;
    }

    if (cfg->calibration_profile_id[0] == '\0') {
        return false;
    }

    if (!is_pct_valid(cfg->force_base_tolerance_pct)) {
        return false;
    }

    if (!is_pct_valid(cfg->full_depth_tolerance_pct)) {
        return false;
    }

    if (!is_pct_valid(cfg->max_pressure_imbalance_pct)) {
        return false;
    }

    if (cfg->full_depth_target_mm < 30 || cfg->full_depth_target_mm > 70) {
        return false;
    }

    if (cfg->full_depth_hall_delta <= 0) {
        return false;
    }

    if (cfg->calibration_window_ms < 500 || cfg->calibration_window_ms > 10000) {
        return false;
    }

    return true;
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

    cfg->mqtt_port = 1883;
    cfg->provisioned = false;

    /* default calibration values */
    cfg->hall_baseline = 3420;
    cfg->hall_min_delta = 520;
    cfg->hall_max_delta = 1060;
    cfg->compression_start_delta = 200;
    cfg->sensor_sample_interval_ms = 20;

    strncpy(
        cfg->calibration_profile_id,
        DEFAULT_CAL_PROFILE_ID,
        sizeof(cfg->calibration_profile_id) - 1
    );
    cfg->calibration_profile_id[sizeof(cfg->calibration_profile_id) - 1] = '\0';

    cfg->force1_base_reference = DEFAULT_FORCE1_BASE_REFERENCE;
    cfg->force2_base_reference = DEFAULT_FORCE2_BASE_REFERENCE;
    cfg->force_base_tolerance_pct = DEFAULT_FORCE_BASE_TOLERANCE_PCT;

    cfg->normal_hall_tolerance = DEFAULT_NORMAL_HALL_TOLERANCE;
    cfg->normal_pressure_tolerance = DEFAULT_NORMAL_PRESSURE_TOLERANCE;

    cfg->full_depth_target_mm = DEFAULT_FULL_DEPTH_TARGET_MM;
    cfg->full_depth_hall_delta = DEFAULT_FULL_DEPTH_HALL_DELTA;
    cfg->full_depth_tolerance_pct = DEFAULT_FULL_DEPTH_TOLERANCE_PCT;

    cfg->recoil_return_threshold_delta = DEFAULT_RECOIL_RETURN_DELTA;
    cfg->max_pressure_imbalance_pct = DEFAULT_MAX_IMBALANCE_PCT;

    cfg->calibration_window_ms = DEFAULT_CALIBRATION_WINDOW_MS;

    cfg->calibration_required = DEFAULT_CALIBRATION_REQUIRED;
    cfg->debug_raw_enabled = DEFAULT_DEBUG_RAW_ENABLED;

    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return err;
    }

    load_str_or_empty(handle, KEY_WIFI_SSID,   cfg->wifi_ssid,    sizeof(cfg->wifi_ssid));
    load_str_or_empty(handle, KEY_WIFI_PASS,   cfg->wifi_pass,    sizeof(cfg->wifi_pass));
    load_str_or_empty(handle, KEY_REG_URL,     cfg->register_url, sizeof(cfg->register_url));
    load_str_or_empty(handle, KEY_MQTT_HOST,   cfg->mqtt_host,    sizeof(cfg->mqtt_host));
    load_str_or_empty(handle, KEY_DEVICE_ID,   cfg->device_id,    sizeof(cfg->device_id));
    load_str_or_empty(handle, KEY_AUTH_TOKEN,  cfg->auth_token,   sizeof(cfg->auth_token));

    uint16_t mqtt_port = 1883;
    if (nvs_get_u16(handle, KEY_MQTT_PORT, &mqtt_port) == ESP_OK) {
        cfg->mqtt_port = (int)mqtt_port;
    }

    uint8_t provisioned = 0;
    if (nvs_get_u8(handle, KEY_PROVISIONED, &provisioned) == ESP_OK) {
        cfg->provisioned = (provisioned == 1);
    }

    load_i32_or_default(handle, KEY_HALL_BASE, &cfg->hall_baseline, 3420);
    load_i32_or_default(handle, KEY_HALL_MIN, &cfg->hall_min_delta, 520);
    load_i32_or_default(handle, KEY_HALL_MAX, &cfg->hall_max_delta, 1060);
    load_i32_or_default(handle, KEY_COMP_START, &cfg->compression_start_delta, 200);
    load_i32_or_default(handle, KEY_SAMPLE_MS, &cfg->sensor_sample_interval_ms, 20);

    load_str_or_default(
        handle,
        KEY_CAL_PROFILE,
        cfg->calibration_profile_id,
        sizeof(cfg->calibration_profile_id),
        DEFAULT_CAL_PROFILE_ID
    );

    load_i32_or_default(
        handle,
        KEY_F1_BASE,
        &cfg->force1_base_reference,
        DEFAULT_FORCE1_BASE_REFERENCE
    );

    load_i32_or_default(
        handle,
        KEY_F2_BASE,
        &cfg->force2_base_reference,
        DEFAULT_FORCE2_BASE_REFERENCE
    );

    load_i32_or_default(
        handle,
        KEY_F_BASE_TOL,
        &cfg->force_base_tolerance_pct,
        DEFAULT_FORCE_BASE_TOLERANCE_PCT
    );

    load_i32_or_default(
        handle,
        KEY_HALL_TOL,
        &cfg->normal_hall_tolerance,
        DEFAULT_NORMAL_HALL_TOLERANCE
    );

    load_i32_or_default(
        handle,
        KEY_PRESS_TOL,
        &cfg->normal_pressure_tolerance,
        DEFAULT_NORMAL_PRESSURE_TOLERANCE
    );

    load_i32_or_default(
        handle,
        KEY_DEPTH_MM,
        &cfg->full_depth_target_mm,
        DEFAULT_FULL_DEPTH_TARGET_MM
    );

    load_i32_or_default(
        handle,
        KEY_DEPTH_DELTA,
        &cfg->full_depth_hall_delta,
        DEFAULT_FULL_DEPTH_HALL_DELTA
    );

    load_i32_or_default(
        handle,
        KEY_DEPTH_TOL,
        &cfg->full_depth_tolerance_pct,
        DEFAULT_FULL_DEPTH_TOLERANCE_PCT
    );

    load_i32_or_default(
        handle,
        KEY_RECOIL_DELTA,
        &cfg->recoil_return_threshold_delta,
        DEFAULT_RECOIL_RETURN_DELTA
    );

    load_i32_or_default(
        handle,
        KEY_IMBALANCE_PCT,
        &cfg->max_pressure_imbalance_pct,
        DEFAULT_MAX_IMBALANCE_PCT
    );

    load_i32_or_default(
        handle,
        KEY_CAL_WINDOW,
        &cfg->calibration_window_ms,
        DEFAULT_CALIBRATION_WINDOW_MS
    );

    load_bool_or_default(
        handle,
        KEY_CAL_REQUIRED,
        &cfg->calibration_required,
        DEFAULT_CALIBRATION_REQUIRED
    );

    load_bool_or_default(
        handle,
        KEY_DEBUG_RAW,
        &cfg->debug_raw_enabled,
        DEFAULT_DEBUG_RAW_ENABLED
    );

    nvs_close(handle);
    return ESP_OK;
}

esp_err_t config_store_save(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!config_store_calibration_values_valid(cfg)) {
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

    err = save_str(handle, KEY_AUTH_TOKEN, cfg->auth_token);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u16(handle, KEY_MQTT_PORT, (uint16_t)cfg->mqtt_port);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u8(handle, KEY_PROVISIONED, cfg->provisioned ? 1 : 0);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_HALL_BASE, cfg->hall_baseline);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_HALL_MIN, cfg->hall_min_delta);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_HALL_MAX, cfg->hall_max_delta);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_COMP_START, cfg->compression_start_delta);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_SAMPLE_MS, cfg->sensor_sample_interval_ms);
    if (err != ESP_OK) goto cleanup;

    err = save_str(handle, KEY_CAL_PROFILE, cfg->calibration_profile_id);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_F1_BASE, cfg->force1_base_reference);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_F2_BASE, cfg->force2_base_reference);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_F_BASE_TOL, cfg->force_base_tolerance_pct);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_HALL_TOL, cfg->normal_hall_tolerance);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_PRESS_TOL, cfg->normal_pressure_tolerance);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_DEPTH_MM, cfg->full_depth_target_mm);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_DEPTH_DELTA, cfg->full_depth_hall_delta);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_DEPTH_TOL, cfg->full_depth_tolerance_pct);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_RECOIL_DELTA, cfg->recoil_return_threshold_delta);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_IMBALANCE_PCT, cfg->max_pressure_imbalance_pct);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_i32(handle, KEY_CAL_WINDOW, cfg->calibration_window_ms);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u8(handle, KEY_CAL_REQUIRED, cfg->calibration_required ? 1 : 0);
    if (err != ESP_OK) goto cleanup;

    err = nvs_set_u8(handle, KEY_DEBUG_RAW, cfg->debug_raw_enabled ? 1 : 0);
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

esp_err_t config_store_clear_wifi_provisioning(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(CONFIG_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to open NVS namespace for clearing provisioning: %s", esp_err_to_name(err));
        return err;
    }

    esp_err_t local_err = ESP_OK;
    esp_err_t e = nvs_erase_key(handle, KEY_WIFI_SSID);
    if (e != ESP_OK && e != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "Failed to erase wifi_ssid: %s", esp_err_to_name(e));
        local_err = e;
    }

    e = nvs_erase_key(handle, KEY_WIFI_PASS);
    if (e != ESP_OK && e != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "Failed to erase wifi_pass: %s", esp_err_to_name(e));
        local_err = (local_err == ESP_OK) ? e : local_err;
    }

    e = nvs_erase_key(handle, KEY_REG_URL);
    if (e != ESP_OK && e != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "Failed to erase reg_url: %s", esp_err_to_name(e));
        local_err = (local_err == ESP_OK) ? e : local_err;
    }

    e = nvs_erase_key(handle, KEY_MQTT_HOST);
    if (e != ESP_OK && e != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "Failed to erase mqtt_host: %s", esp_err_to_name(e));
        local_err = (local_err == ESP_OK) ? e : local_err;
    }

    e = nvs_erase_key(handle, KEY_MQTT_PORT);
    if (e != ESP_OK && e != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGW(TAG, "Failed to erase mqtt_port: %s", esp_err_to_name(e));
        local_err = (local_err == ESP_OK) ? e : local_err;
    }

    /* Mark device as not provisioned */
    e = nvs_set_u8(handle, KEY_PROVISIONED, 0);
    if (e != ESP_OK) {
        ESP_LOGW(TAG, "Failed to set provisioned flag to false: %s", esp_err_to_name(e));
        local_err = (local_err == ESP_OK) ? e : local_err;
    }

    esp_err_t commit_err = nvs_commit(handle);
    if (commit_err != ESP_OK) {
        ESP_LOGW(TAG, "Failed to commit cleared provisioning data: %s", esp_err_to_name(commit_err));
        if (local_err == ESP_OK) local_err = commit_err;
    } else {
        ESP_LOGI(TAG, "Cleared Wi-Fi provisioning data (ssid, password, reg_url, mqtt host/port) and set provisioned=false");
    }

    nvs_close(handle);
    return local_err;
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