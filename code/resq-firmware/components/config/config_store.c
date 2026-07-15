#include "config_store.h"
#include "calibration_fingerprint.h"
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <math.h>

#include "esp_mac.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "config_store";

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

#define NVS_KEY_CAL_SAMPLES         "cal_samples"
#define NVS_KEY_CAL_WINDOW_MS       "cal_window_ms"
#define NVS_KEY_CALIBRATED_AT_MS    "calibrated_at"

#define NVS_KEY_CAL_META       "cal_meta"
#define NVS_KEY_SLOT_0         "cal_slot_0"
#define NVS_KEY_SLOT_1         "cal_slot_1"

#define CALIBRATION_META_MAGIC            0x4D455441
#define CALIBRATION_SLOT_HEADER_MAGIC     0x43414C53

#define CALIBRATION_META_SCHEMA_VERSION   1
#define CALIBRATION_RECORD_SCHEMA_VERSION 1
#define CALIBRATION_SLOT_NONE             0xFF

/* Struct definitions private to config_store.c */

typedef struct {
    uint32_t magic;                  // CALIBRATION_META_MAGIC
    uint32_t schema_version;         // CALIBRATION_META_SCHEMA_VERSION (1)
    uint8_t  active_slot;            // 0, 1, or CALIBRATION_SLOT_NONE
    uint8_t  recalibration_required; // 1 or 0
    uint8_t  reserved[2];            // Padding, must be 0
    uint32_t active_generation;      // Generation counter (0 when active_slot == NONE)
    uint32_t crc32;                  // CRC32 of first 16 bytes
} calibration_meta_t;

_Static_assert(sizeof(calibration_meta_t) == 20, "calibration_meta_t size mismatch");
_Static_assert(offsetof(calibration_meta_t, crc32) == 16, "calibration_meta_t CRC offset must be 16");

typedef struct {
    // --- Hall ---
    int32_t  hall_baseline;
    int32_t  hall_delta;
    int32_t  hall_range_raw;
    int32_t  hall_direction;
    int32_t  hall_noise_raw;
    int32_t  hall_start_delta;
    int32_t  hall_full_delta_threshold;
    int32_t  hall_recoil_delta;
    int32_t  hall_tolerance_raw;
    int32_t  hall_full_press;
    int32_t  full_depth_mm_scaled;      // derived from full_depth_mm float * 1000
    // --- Pressure targets ---
    int32_t  ref_pressure;
    int32_t  bladder_1_pressure;
    int32_t  bladder_2_pressure;
    int32_t  bladder_1_full_press;
    int32_t  bladder_2_full_press;
    // --- Pressure baselines / calibration ---
    int32_t  pressure_0_baseline;
    int32_t  pressure_1_baseline;
    int32_t  pressure_2_baseline;
    int32_t  pressure_0_kpa_scaled;     // derived from pressure_0_kpa_per_count * 1e9
    int32_t  pressure_1_kpa_scaled;     // derived from pressure_1_kpa_per_count * 1e9
    int32_t  pressure_2_kpa_scaled;     // derived from pressure_2_kpa_per_count * 1e9
    int32_t  pressure_0_noise_raw;
    int32_t  pressure_1_noise_raw;
    int32_t  pressure_2_noise_raw;
    int32_t  pressure_1_range_raw;
    int32_t  pressure_2_range_raw;
    int32_t  pressure_contact_threshold;
    int32_t  pressure_valid_threshold;
    int32_t  pressure_balance_allowed_pct;
    int32_t  pressure_mode;             // enum stored as int32_t
    // --- Operational flags (uint8_t, NOT bool) ---
    uint8_t  pressure_degraded;
    uint8_t  using_last_stable_pressure;
    uint8_t  pressure_valid;
    uint8_t  hall_valid;
    // --- Session config ---
    int32_t  calibration_sample_count;
    int32_t  calibration_window_ms;
    // --- Timestamp ---
    int64_t  calibrated_at_ms;
} calibration_persist_payload_t;

_Static_assert(sizeof(calibration_persist_payload_t) == 144, "payload size mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_baseline) == 0, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_delta) == 4, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_range_raw) == 8, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_direction) == 12, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_noise_raw) == 16, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_start_delta) == 20, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_full_delta_threshold) == 24, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_recoil_delta) == 28, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_tolerance_raw) == 32, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_full_press) == 36, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, full_depth_mm_scaled) == 40, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, ref_pressure) == 44, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, bladder_1_pressure) == 48, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, bladder_2_pressure) == 52, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, bladder_1_full_press) == 56, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, bladder_2_full_press) == 60, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_0_baseline) == 64, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_1_baseline) == 68, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_2_baseline) == 72, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_0_kpa_scaled) == 76, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_1_kpa_scaled) == 80, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_2_kpa_scaled) == 84, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_0_noise_raw) == 88, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_1_noise_raw) == 92, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_2_noise_raw) == 96, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_1_range_raw) == 100, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_2_range_raw) == 104, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_contact_threshold) == 108, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_valid_threshold) == 112, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_balance_allowed_pct) == 116, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_mode) == 120, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_degraded) == 124, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, using_last_stable_pressure) == 125, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, pressure_valid) == 126, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, hall_valid) == 127, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, calibration_sample_count) == 128, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, calibration_window_ms) == 132, "offset mismatch");
_Static_assert(offsetof(calibration_persist_payload_t, calibrated_at_ms) == 136, "offset mismatch");

typedef struct {
    uint32_t magic;                  // CALIBRATION_SLOT_HEADER_MAGIC
    uint32_t schema_version;         // CALIBRATION_RECORD_SCHEMA_VERSION (1)
    uint32_t header_size;            // offsetof(calibration_slot_t, payload)
    uint32_t payload_size;           // sizeof(calibration_persist_payload_t)
    uint32_t generation;
    uint32_t profile_version;
    char     profile_id[32];         // Matches runtime config profile_id[32]
    char     profile_hash[CALIBRATION_PROFILE_HASH_BYTES + 1]; // Hex-encoded SHA-256 + null term
    uint8_t  _hash_pad[7];           // Padding to align to 8-byte boundary
    calibration_persist_payload_t payload;
    uint32_t crc32;                  // CRC32 of offsetof(calibration_slot_t, crc32) bytes
} calibration_slot_t;

_Static_assert(sizeof(calibration_slot_t) == 280, "calibration_slot_t size mismatch");
_Static_assert(offsetof(calibration_slot_t, magic) == 0, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, schema_version) == 4, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, header_size) == 8, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, payload_size) == 12, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, generation) == 16, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, profile_version) == 20, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, profile_id) == 24, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, profile_hash) == 56, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, _hash_pad) == 121, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, payload) == 128, "offset mismatch");
_Static_assert(offsetof(calibration_slot_t, crc32) == 272, "offset mismatch");

/* LOCKING: s_store_mutex protects all NVS metadata and slot operations.
 * Public functions acquire the mutex. Internal helpers suffixed _locked()
 * must only be called while the mutex is already held.
 * Lock order: calibration-manager mutex -> s_store_mutex.
 * Do not hold any lock during sensor I/O or MQTT publication. */
static SemaphoreHandle_t s_store_mutex = NULL;
static bool s_config_store_initialized = false;



static cal_store_outcome_t get_snapshot_locked(nvs_handle_t handle, calibration_store_snapshot_t *out);

#define LOCK_STORE()   do { if (s_store_mutex) xSemaphoreTake(s_store_mutex, portMAX_DELAY); } while(0)
#define UNLOCK_STORE() do { if (s_store_mutex) xSemaphoreGive(s_store_mutex); } while(0)

/* Helper CRC calculation */
static uint32_t calculate_crc32(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            if (crc & 1) {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    return ~crc;
}

static uint32_t calculate_meta_crc(const calibration_meta_t *meta)
{
    return calculate_crc32((const uint8_t *)meta, offsetof(calibration_meta_t, crc32));
}

/* Scaled numeric conversions */
static bool validate_float_to_scaled_i32(float val, float scale, int32_t *out_val)
{
    if (isnan(val) || isinf(val)) {
        return false;
    }
    double scaled = (double)val * (double)scale;
    if (scaled > (double)INT32_MAX || scaled < (double)INT32_MIN) {
        return false;
    }
    *out_val = (int32_t)(scaled >= 0.0 ? scaled + 0.5 : scaled - 0.5);
    return true;
}

static float reconstruct_scaled_i32_to_float(int32_t val, float scale)
{
    return (float)val / scale;
}

/* Internal conversions */
static bool runtime_to_persisted(const calibration_config_t *run, calibration_persist_payload_t *pers)
{
    memset(pers, 0, sizeof(calibration_persist_payload_t));
    pers->hall_baseline = run->hall_baseline;
    pers->hall_delta = run->hall_delta;
    pers->hall_range_raw = run->hall_range_raw;
    pers->hall_direction = run->hall_direction;
    pers->hall_noise_raw = run->hall_noise_raw;
    pers->hall_start_delta = run->hall_start_delta;
    pers->hall_full_delta_threshold = run->hall_full_delta_threshold;
    pers->hall_recoil_delta = run->hall_recoil_delta;
    pers->hall_tolerance_raw = run->hall_tolerance_raw;
    pers->hall_full_press = run->hall_full_press;

    if (!validate_float_to_scaled_i32(run->full_depth_mm, 1000.0f, &pers->full_depth_mm_scaled)) {
        return false;
    }

    pers->ref_pressure = run->ref_pressure;
    pers->bladder_1_pressure = run->bladder_1_pressure;
    pers->bladder_2_pressure = run->bladder_2_pressure;
    pers->bladder_1_full_press = run->bladder_1_full_press;
    pers->bladder_2_full_press = run->bladder_2_full_press;

    pers->pressure_0_baseline = run->pressure_0_baseline;
    pers->pressure_1_baseline = run->pressure_1_baseline;
    pers->pressure_2_baseline = run->pressure_2_baseline;

    if (!validate_float_to_scaled_i32(run->pressure_0_kpa_per_count, 1e9f, &pers->pressure_0_kpa_scaled)) {
        return false;
    }
    if (!validate_float_to_scaled_i32(run->pressure_1_kpa_per_count, 1e9f, &pers->pressure_1_kpa_scaled)) {
        return false;
    }
    if (!validate_float_to_scaled_i32(run->pressure_2_kpa_per_count, 1e9f, &pers->pressure_2_kpa_scaled)) {
        return false;
    }

    pers->pressure_0_noise_raw = run->pressure_0_noise_raw;
    pers->pressure_1_noise_raw = run->pressure_1_noise_raw;
    pers->pressure_2_noise_raw = run->pressure_2_noise_raw;
    pers->pressure_1_range_raw = run->pressure_1_range_raw;
    pers->pressure_2_range_raw = run->pressure_2_range_raw;
    pers->pressure_contact_threshold = run->pressure_contact_threshold;
    pers->pressure_valid_threshold = run->pressure_valid_threshold;
    pers->pressure_balance_allowed_pct = run->pressure_balance_allowed_pct;
    pers->pressure_mode = (int32_t)run->pressure_mode;

    pers->pressure_degraded = run->pressure_degraded ? 1 : 0;
    pers->using_last_stable_pressure = run->using_last_stable_pressure ? 1 : 0;
    pers->pressure_valid = run->pressure_valid ? 1 : 0;
    pers->hall_valid = run->hall_valid ? 1 : 0;

    pers->calibration_sample_count = run->calibration_sample_count;
    pers->calibration_window_ms = run->calibration_window_ms;
    pers->calibrated_at_ms = run->calibrated_at_ms;

    return true;
}

static void persisted_to_runtime(const calibration_persist_payload_t *pers, calibration_config_t *run)
{
    run->hall_baseline = pers->hall_baseline;
    run->hall_delta = pers->hall_delta;
    run->hall_range_raw = pers->hall_range_raw;
    run->hall_direction = pers->hall_direction;
    run->hall_noise_raw = pers->hall_noise_raw;
    run->hall_start_delta = pers->hall_start_delta;
    run->hall_full_delta_threshold = pers->hall_full_delta_threshold;
    run->hall_recoil_delta = pers->hall_recoil_delta;
    run->hall_tolerance_raw = pers->hall_tolerance_raw;
    run->hall_full_press = pers->hall_full_press;

    run->full_depth_mm = reconstruct_scaled_i32_to_float(pers->full_depth_mm_scaled, 1000.0f);

    run->ref_pressure = pers->ref_pressure;
    run->bladder_1_pressure = pers->bladder_1_pressure;
    run->bladder_2_pressure = pers->bladder_2_pressure;
    run->bladder_1_full_press = pers->bladder_1_full_press;
    run->bladder_2_full_press = pers->bladder_2_full_press;

    run->pressure_0_baseline = pers->pressure_0_baseline;
    run->pressure_1_baseline = pers->pressure_1_baseline;
    run->pressure_2_baseline = pers->pressure_2_baseline;

    run->pressure_0_kpa_per_count = reconstruct_scaled_i32_to_float(pers->pressure_0_kpa_scaled, 1e9f);
    run->pressure_1_kpa_per_count = reconstruct_scaled_i32_to_float(pers->pressure_1_kpa_scaled, 1e9f);
    run->pressure_2_kpa_per_count = reconstruct_scaled_i32_to_float(pers->pressure_2_kpa_scaled, 1e9f);

    run->pressure_0_noise_raw = pers->pressure_0_noise_raw;
    run->pressure_1_noise_raw = pers->pressure_1_noise_raw;
    run->pressure_2_noise_raw = pers->pressure_2_noise_raw;
    run->pressure_1_range_raw = pers->pressure_1_range_raw;
    run->pressure_2_range_raw = pers->pressure_2_range_raw;
    run->pressure_contact_threshold = pers->pressure_contact_threshold;
    run->pressure_valid_threshold = pers->pressure_valid_threshold;
    run->pressure_balance_allowed_pct = pers->pressure_balance_allowed_pct;
    run->pressure_mode = (calibration_pressure_mode_t)pers->pressure_mode;

    run->pressure_degraded = pers->pressure_degraded ? true : false;
    run->using_last_stable_pressure = pers->using_last_stable_pressure ? true : false;
    run->pressure_valid = pers->pressure_valid ? true : false;
    run->hall_valid = pers->hall_valid ? true : false;

    run->calibration_sample_count = pers->calibration_sample_count;
    run->calibration_window_ms = pers->calibration_window_ms;
    run->calibrated_at_ms = pers->calibrated_at_ms;
}

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
 * @brief Initialize NVS flash storage.
 */
esp_err_t config_store_init(void)
{
    if (s_store_mutex == NULL) {
        s_store_mutex = xSemaphoreCreateMutex();
        if (s_store_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    LOCK_STORE();

    esp_err_t err = nvs_flash_init();

    if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
        err == ESP_ERR_NVS_NEW_VERSION_FOUND) {

        err = nvs_flash_erase();
        if (err == ESP_OK) {
            err = nvs_flash_init();
        }
    }

    if (err == ESP_OK) {
        s_config_store_initialized = true;
    }

    UNLOCK_STORE();
    return err;
}

/**
 * @brief Read ESP hardware MAC and write it as a string.
 */
esp_err_t config_store_get_device_mac(char *buffer, size_t buffer_len)
{
    if (buffer == NULL || buffer_len < 18) {
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
                           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    if (written != 17) {
        buffer[0] = '\0';
        return ESP_FAIL;
    }

    return ESP_OK;
}

/* safe string helper */
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
 * @brief Load network config from NVS.
 */
esp_err_t config_store_load_network(network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    network_config_set_defaults(config);

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        network_config_set_defaults(config);
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);

    if (err == ESP_ERR_NVS_NOT_FOUND) {
        UNLOCK_STORE();
        return ESP_OK;
    }

    if (err != ESP_OK) {
        UNLOCK_STORE();
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
    nvs_get_u8(handle, NVS_KEY_PROVISIONED, &provisioned);
    config->provisioned = provisioned ? true : false;

    nvs_close(handle);
    UNLOCK_STORE();
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

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return err;
    }

    err = nvs_set_str(handle, NVS_KEY_WIFI_SSID, config->wifi_ssid);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_WIFI_PASS, config->wifi_pass);
    if (err != ESP_OK) goto exit;

    err = nvs_set_str(handle, NVS_KEY_BACKEND_BASE_URL, config->backend_base_url);
    if (err != ESP_OK) goto exit;

    /* Erase legacy keys */
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_BACKEND_REGISTERED);
    nvs_erase_key(handle, NVS_KEY_DEVICE_ID);
    nvs_erase_key(handle, NVS_KEY_REGISTER_URL);

    err = nvs_set_u8(handle, NVS_KEY_PROVISIONED, config->provisioned ? 1 : 0);
    if (err != ESP_OK) goto exit;

    err = nvs_commit(handle);

exit:
    nvs_close(handle);
    UNLOCK_STORE();
    return err;
}

/* Locked read of metadata */
static cal_store_outcome_t read_calibration_meta_locked(nvs_handle_t handle, calibration_meta_t *out)
{
    memset(out, 0, sizeof(calibration_meta_t));
    size_t len = sizeof(calibration_meta_t);
    esp_err_t err = nvs_get_blob(handle, NVS_KEY_CAL_META, out, &len);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        return CAL_STORE_NOT_FOUND;
    }
    if (err != ESP_OK) {
        return CAL_STORE_IO_ERROR;
    }
    if (len != sizeof(calibration_meta_t)) {
        return CAL_STORE_CORRUPT;
    }
    if (out->magic != CALIBRATION_META_MAGIC) {
        return CAL_STORE_CORRUPT;
    }
    if (out->schema_version != CALIBRATION_META_SCHEMA_VERSION) {
        return CAL_STORE_UNSUPPORTED_SCHEMA;
    }
    uint32_t calc_crc = calculate_meta_crc(out);
    if (out->crc32 != calc_crc) {
        return CAL_STORE_CORRUPT;
    }
    if (out->reserved[0] != 0 || out->reserved[1] != 0) {
        return CAL_STORE_CORRUPT;
    }
    if (out->recalibration_required != 0 && out->recalibration_required != 1) {
        return CAL_STORE_CORRUPT;
    }
    if (out->active_slot != CALIBRATION_SLOT_NONE && out->active_slot != 0 && out->active_slot != 1) {
        return CAL_STORE_CORRUPT;
    }
    if (out->active_slot == CALIBRATION_SLOT_NONE) {
        if (out->active_generation != 0) {
            return CAL_STORE_CORRUPT;
        }
    } else {
        if (out->active_generation == 0) {
            return CAL_STORE_CORRUPT;
        }
    }
    return CAL_STORE_VALID;
}

/* Locked write of metadata */
static esp_err_t write_and_verify_meta_locked(nvs_handle_t handle, calibration_meta_t *meta)
{
    meta->crc32 = calculate_meta_crc(meta);
    esp_err_t err = nvs_set_blob(handle, NVS_KEY_CAL_META, meta, sizeof(calibration_meta_t));
    if (err != ESP_OK) {
        return err;
    }
    err = nvs_commit(handle);
    if (err != ESP_OK) {
        return err;
    }
    calibration_meta_t verify;
    size_t len = sizeof(calibration_meta_t);
    err = nvs_get_blob(handle, NVS_KEY_CAL_META, &verify, &len);
    if (err != ESP_OK || len != sizeof(calibration_meta_t) ||
        verify.magic != meta->magic ||
        verify.schema_version != meta->schema_version ||
        verify.active_slot != meta->active_slot ||
        verify.recalibration_required != meta->recalibration_required ||
        verify.active_generation != meta->active_generation ||
        verify.crc32 != meta->crc32) {
        return ESP_FAIL;
    }
    return ESP_OK;
}

/* Locked load of calibration slot */
static cal_store_outcome_t load_calibration_locked(nvs_handle_t handle, calibration_config_t *config, calibration_meta_t *meta_out)
{
    // Zero-initialize meta before read; never expose uninitialized fields
    calibration_meta_t meta;
    memset(&meta, 0, sizeof(meta));
    cal_store_outcome_t meta_outcome = read_calibration_meta_locked(handle, &meta);
    // meta_out populated only after full validation succeeds (see end of function)

    // Pre-check slot blob sizes to detect malformed-but-present blobs
    size_t probe0 = 0;
    esp_err_t probe_err0 = nvs_get_blob(handle, NVS_KEY_SLOT_0, NULL, &probe0);
    bool slot0_present = (probe_err0 == ESP_OK);         // correct size
    bool slot0_malformed = (probe_err0 != ESP_OK && probe_err0 != ESP_ERR_NVS_NOT_FOUND);
    if (probe_err0 == ESP_OK && probe0 != sizeof(calibration_slot_t)) {
        slot0_present = false;
        slot0_malformed = true;
    }

    size_t probe1 = 0;
    esp_err_t probe_err1 = nvs_get_blob(handle, NVS_KEY_SLOT_1, NULL, &probe1);
    bool slot1_present = (probe_err1 == ESP_OK);
    bool slot1_malformed = (probe_err1 != ESP_OK && probe_err1 != ESP_ERR_NVS_NOT_FOUND);
    if (probe_err1 == ESP_OK && probe1 != sizeof(calibration_slot_t)) {
        slot1_present = false;
        slot1_malformed = true;
    }

    // A slot blob that exists but is the wrong size is treated as present (CORRUPT, not MISSING)
    bool slots_any = slot0_present || slot1_present || slot0_malformed || slot1_malformed;

    // Check legacy
    int32_t dummy_hall = 0;
    bool legacy_exists = (nvs_get_i32(handle, NVS_KEY_HALL_DELTA, &dummy_hall) == ESP_OK);
    (void)legacy_exists; // used by callers, not here

    if (meta_outcome == CAL_STORE_NOT_FOUND) {
        return slots_any ? CAL_STORE_CORRUPT : CAL_STORE_NOT_FOUND;
    }

    if (meta_outcome != CAL_STORE_VALID) {
        return meta_outcome;
    }

    if (meta.active_slot == CALIBRATION_SLOT_NONE) {
        return slots_any ? CAL_STORE_CORRUPT : CAL_STORE_NOT_FOUND;
    }

    if (meta.active_slot != 0 && meta.active_slot != 1) {
        return CAL_STORE_CORRUPT;
    }

    // Validate recalibration_required is a boolean flag
    if (meta.recalibration_required != 0 && meta.recalibration_required != 1) {
        return CAL_STORE_CORRUPT;
    }

    // Read selected active slot — size already probed above
    const char *active_key = (meta.active_slot == 0) ? NVS_KEY_SLOT_0 : NVS_KEY_SLOT_1;
    size_t active_reported_len = (meta.active_slot == 0) ? probe0 : probe1;
    esp_err_t active_probe_err = (meta.active_slot == 0) ? probe_err0 : probe_err1;

    if (active_probe_err == ESP_ERR_NVS_NOT_FOUND) {
        return CAL_STORE_CORRUPT;  // metadata selects slot but blob is absent
    }
    if (active_probe_err != ESP_OK) {
        return CAL_STORE_IO_ERROR;
    }
    if (active_reported_len != sizeof(calibration_slot_t)) {
        return CAL_STORE_CORRUPT;  // blob exists but is the wrong size
    }

    calibration_slot_t active_slot_data;
    size_t active_len = sizeof(calibration_slot_t);
    esp_err_t slot_err = nvs_get_blob(handle, active_key, &active_slot_data, &active_len);
    if (slot_err != ESP_OK) {
        return CAL_STORE_IO_ERROR;
    }
    if (active_len != sizeof(calibration_slot_t)) {
        return CAL_STORE_CORRUPT;
    }

    // Validate active slot envelope
    if (active_slot_data.magic != CALIBRATION_SLOT_HEADER_MAGIC) {
        return CAL_STORE_CORRUPT;
    }
    if (active_slot_data.schema_version != CALIBRATION_RECORD_SCHEMA_VERSION) {
        return CAL_STORE_UNSUPPORTED_SCHEMA;
    }
    if (active_slot_data.header_size != offsetof(calibration_slot_t, payload)) {
        return CAL_STORE_CORRUPT;
    }
    if (active_slot_data.payload_size != sizeof(calibration_persist_payload_t)) {
        return CAL_STORE_CORRUPT;
    }
    if (active_slot_data.generation != meta.active_generation) {
        return CAL_STORE_CORRUPT;
    }

    if (active_slot_data.profile_version <= 0) {
        return CAL_STORE_CORRUPT;
    }

    // Validate profile_id: must be null-terminated within 32 bytes and non-empty
    const void *id_null = memchr(active_slot_data.profile_id, '\0', sizeof(active_slot_data.profile_id));
    if (id_null == NULL) {
        return CAL_STORE_CORRUPT;  // no null terminator within buffer
    }
    size_t id_len = strlen(active_slot_data.profile_id);
    if (id_len == 0 || id_len >= 32) {
        return CAL_STORE_CORRUPT;
    }

    // Validate profile_hash: must have null at exactly index 64, all 64 chars are lowercase hex, not all zero
    const void *hash_null = memchr(active_slot_data.profile_hash, '\0', sizeof(active_slot_data.profile_hash));
    if (hash_null == NULL) {
        return CAL_STORE_CORRUPT;
    }
    size_t hash_len = strlen(active_slot_data.profile_hash);
    if (hash_len != 64) {
        return CAL_STORE_CORRUPT;
    }
    bool is_zero_hash = true;
    for (size_t i = 0; i < 64; i++) {
        char c = active_slot_data.profile_hash[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return CAL_STORE_CORRUPT;
        }
        if (c != '0') is_zero_hash = false;
    }
    if (is_zero_hash) {
        return CAL_STORE_CORRUPT;
    }

    // Validate persisted boolean flags are strictly 0 or 1
    if ((active_slot_data.payload.pressure_degraded != 0 && active_slot_data.payload.pressure_degraded != 1) ||
        (active_slot_data.payload.using_last_stable_pressure != 0 && active_slot_data.payload.using_last_stable_pressure != 1) ||
        (active_slot_data.payload.pressure_valid != 0 && active_slot_data.payload.pressure_valid != 1) ||
        (active_slot_data.payload.hall_valid != 0 && active_slot_data.payload.hall_valid != 1)) {
        return CAL_STORE_CORRUPT;
    }

    // Validate pressure_mode is a known enum value (0=REQUIRED, 1=OPTIONAL, 3=HALL_WITH_LAST_STABLE)
    uint8_t pm = active_slot_data.payload.pressure_mode;
    if (pm != 0 && pm != 1 && pm != 3) {
        return CAL_STORE_CORRUPT;
    }

    // Validate critical numeric calibration invariants
    if (active_slot_data.payload.hall_delta == 0) {
        return CAL_STORE_CORRUPT;
    }
    if (active_slot_data.payload.full_depth_mm_scaled <= 0) {
        return CAL_STORE_CORRUPT;
    }

    // Validate reconstructed floats are finite
    float full_depth_mm = reconstruct_scaled_i32_to_float(active_slot_data.payload.full_depth_mm_scaled, 1000.0f);
    float p0_kpa = reconstruct_scaled_i32_to_float(active_slot_data.payload.pressure_0_kpa_scaled, 1e9f);
    float p1_kpa = reconstruct_scaled_i32_to_float(active_slot_data.payload.pressure_1_kpa_scaled, 1e9f);
    float p2_kpa = reconstruct_scaled_i32_to_float(active_slot_data.payload.pressure_2_kpa_scaled, 1e9f);
    if (!isfinite(full_depth_mm) || !isfinite(p0_kpa) || !isfinite(p1_kpa) || !isfinite(p2_kpa)) {
        return CAL_STORE_CORRUPT;
    }

    // Validate slot CRC
    uint32_t calc_crc = calculate_crc32((const uint8_t *)&active_slot_data, offsetof(calibration_slot_t, crc32));
    if (active_slot_data.crc32 != calc_crc) {
        return CAL_STORE_CORRUPT;
    }

    // Populate meta_out only after full validation succeeds
    if (meta_out) {
        *meta_out = meta;
    }

    // Convert and populate config
    persisted_to_runtime(&active_slot_data.payload, config);
    snprintf(config->profile_id, sizeof(config->profile_id), "%s", active_slot_data.profile_id);
    snprintf(config->profile_hash, sizeof(config->profile_hash), "%s", active_slot_data.profile_hash);
    config->profile_version = active_slot_data.profile_version;
    config->calibration_schema_version = active_slot_data.schema_version;
    config->calibration_generation = active_slot_data.generation;
    config->recalibration_required = meta.recalibration_required;
    strcpy(config->calibration_storage_status, "VALID");

    if (meta.recalibration_required == 1) {
        config->calibrated = false;
    } else {
        config->calibrated = true;
    }

    return CAL_STORE_VALID;
}

/**
 * @brief Load calibration config from NVS.
 */
esp_err_t config_store_load_calibration(calibration_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        config->recalibration_required = true;
        config->calibrated = false;
        return ESP_ERR_INVALID_STATE;
    }

    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "MISSING");
        config->recalibration_required = true;
        config->calibrated = false;
        UNLOCK_STORE();
        return ESP_OK;
    }
    if (err != ESP_OK) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        config->recalibration_required = true;
        config->calibrated = false;
        UNLOCK_STORE();
        return err;
    }

    calibration_meta_t meta;
    cal_store_outcome_t outcome = load_calibration_locked(handle, config, &meta);
    nvs_close(handle);

    if (outcome == CAL_STORE_NOT_FOUND) {
        nvs_handle_t handle_legacy;
        bool legacy_exists = false;
        if (config_store_open(NVS_READONLY, &handle_legacy) == ESP_OK) {
            int32_t dummy_hall = 0;
            if (nvs_get_i32(handle_legacy, NVS_KEY_HALL_DELTA, &dummy_hall) == ESP_OK) {
                legacy_exists = true;
            }
            nvs_close(handle_legacy);
        }

        calibration_config_set_defaults(config);
        if (legacy_exists) {
            snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "LEGACY_UNVERIFIED");
        } else {
            snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "MISSING");
        }
        config->recalibration_required = true;
        config->calibrated = false;
        UNLOCK_STORE();
        return ESP_OK;
    }

    if (outcome == CAL_STORE_CORRUPT) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "CORRUPT");
        config->recalibration_required = true;
        config->calibrated = false;

        // Persist recalibration_required = 1 to NVS
        nvs_handle_t rw_handle;
        if (config_store_open(NVS_READWRITE, &rw_handle) == ESP_OK) {
            calibration_meta_t rw_meta;
            cal_store_outcome_t rw_meta_outcome = read_calibration_meta_locked(rw_handle, &rw_meta);
            if (rw_meta_outcome == CAL_STORE_VALID) {
                if (rw_meta.recalibration_required != 1) {
                    rw_meta.recalibration_required = 1;
                    write_and_verify_meta_locked(rw_handle, &rw_meta);
                }
            }
            nvs_close(rw_handle);
        }
        UNLOCK_STORE();
        return ESP_OK;
    }

    if (outcome == CAL_STORE_UNSUPPORTED_SCHEMA) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNSUPPORTED_SCHEMA");
        config->recalibration_required = true;
        config->calibrated = false;
        UNLOCK_STORE();
        return ESP_OK;
    }

    if (outcome == CAL_STORE_IO_ERROR) {
        calibration_config_set_defaults(config);
        snprintf(config->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        config->recalibration_required = true;
        config->calibrated = false;
        UNLOCK_STORE();
        return ESP_FAIL;
    }

    UNLOCK_STORE();
    return ESP_OK;
}

/**
 * @brief Promote candidate calibration to committed active calibration in NVS.
 */
cal_store_outcome_t config_store_promote_calibration(
    const calibration_config_t *candidate,
    calibration_config_t *out_committed,
    calibration_store_snapshot_t *out_snapshot
)
{
    if (candidate == NULL || out_committed == NULL || out_snapshot == NULL) {
        return CAL_STORE_IO_ERROR;
    }

    if (candidate->profile_version <= 0) {
        return CAL_STORE_CORRUPT;
    }
    const void *id_null_ptr = memchr(candidate->profile_id, '\0', 32);
    if (id_null_ptr == NULL) {
        return CAL_STORE_CORRUPT;
    }
    size_t id_len = strlen(candidate->profile_id);
    if (id_len == 0 || id_len > 31) {
        return CAL_STORE_CORRUPT;
    }
    for (size_t i = 0; i < id_len; i++) {
        char c = candidate->profile_id[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) {
            return CAL_STORE_CORRUPT;
        }
    }
    const void *hash_null_ptr = memchr(candidate->profile_hash, '\0', 65);
    if (hash_null_ptr == NULL) {
        return CAL_STORE_CORRUPT;
    }
    size_t hash_len = strlen(candidate->profile_hash);
    if (hash_len != 64) {
        return CAL_STORE_CORRUPT;
    }
    bool is_zero_hash = true;
    for (size_t i = 0; i < 64; i++) {
        char c = candidate->profile_hash[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
            return CAL_STORE_CORRUPT;
        }
        if (c != '0') {
            is_zero_hash = false;
        }
    }
    if (is_zero_hash) {
        return CAL_STORE_CORRUPT;
    }

    // Recompute fingerprint immediately before promotion and compare semantically
    char recomputed_hash[65];
    esp_err_t fp_err = calibration_fingerprint_calculate(
        candidate->profile_id,
        candidate->profile_version,
        candidate->hall_delta,
        candidate->ref_pressure,
        candidate->bladder_1_pressure,
        candidate->bladder_2_pressure,
        recomputed_hash,
        sizeof(recomputed_hash)
    );
    if (fp_err != ESP_OK) {
        return CAL_STORE_IO_ERROR;
    }
    if (strcmp(recomputed_hash, candidate->profile_hash) != 0) {
        return CAL_STORE_PROFILE_HASH_MISMATCH;
    }

    // Validate enum and ranges
    if (candidate->pressure_mode != CALIBRATION_PRESSURE_REQUIRED &&
        candidate->pressure_mode != CALIBRATION_PRESSURE_OPTIONAL &&
        candidate->pressure_mode != CALIBRATION_HALL_ONLY &&
        candidate->pressure_mode != CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE) {
        return CAL_STORE_CORRUPT;
    }
    if (candidate->hall_delta == 0) {
        return CAL_STORE_CORRUPT;
    }
    if (candidate->full_depth_mm <= 0.0f) {
        return CAL_STORE_CORRUPT;
    }
    if (candidate->calibration_sample_count <= 0 || candidate->calibration_window_ms <= 0) {
        return CAL_STORE_CORRUPT;
    }
    if (candidate->hall_range_raw <= 30) {
        return CAL_STORE_CORRUPT;
    }
    if (!calibration_config_is_valid(candidate)) {
        return CAL_STORE_CORRUPT;
    }

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        if (out_snapshot) {
            memset(out_snapshot, 0, sizeof(calibration_store_snapshot_t));
            snprintf(out_snapshot->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
            out_snapshot->recalibration_required = 1;
        }
        return CAL_STORE_IO_ERROR;
    }
    LOCK_STORE();

    // 2. Open handle in READWRITE mode
    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    // 3. Read metadata
    calibration_meta_t meta;
    cal_store_outcome_t meta_outcome = read_calibration_meta_locked(handle, &meta);
    if (meta_outcome != CAL_STORE_VALID) {
        nvs_close(handle);
        UNLOCK_STORE();
        return meta_outcome;  // propagate CORRUPT / UNSUPPORTED_SCHEMA / IO_ERROR
    }

    // 4. Verify recalibration_required is 1
    if (meta.recalibration_required != 1) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;  // no pending recalibration
    }

    // 5. Determine next slot
    uint8_t next_slot = (meta.active_slot == 0) ? 1 : 0;
    if (meta.active_slot == CALIBRATION_SLOT_NONE) {
        next_slot = 0;
    }

    // 6. Generation overflow check
    if (meta.active_generation == UINT32_MAX) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_GENERATION_EXHAUSTED;
    }
    uint32_t next_generation = meta.active_generation + 1;

    // 7. Construct new slot data
    calibration_slot_t slot_data;
    memset(&slot_data, 0, sizeof(calibration_slot_t));
    slot_data.magic = CALIBRATION_SLOT_HEADER_MAGIC;
    slot_data.schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
    slot_data.header_size = offsetof(calibration_slot_t, payload);
    slot_data.payload_size = sizeof(calibration_persist_payload_t);
    slot_data.generation = next_generation;
    slot_data.profile_version = candidate->profile_version;
    snprintf(slot_data.profile_id, sizeof(slot_data.profile_id), "%s", candidate->profile_id);
    snprintf(slot_data.profile_hash, sizeof(slot_data.profile_hash), "%s", candidate->profile_hash);

    if (!runtime_to_persisted(candidate, &slot_data.payload)) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    slot_data.crc32 = calculate_crc32((const uint8_t *)&slot_data, offsetof(calibration_slot_t, crc32));

    // 8. Write inactive slot blob
    err = nvs_set_blob(handle, next_slot == 0 ? NVS_KEY_SLOT_0 : NVS_KEY_SLOT_1, &slot_data, sizeof(calibration_slot_t));
    if (err != ESP_OK) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    err = nvs_commit(handle);
    if (err != ESP_OK) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    // 9. Read back and validate slot
    calibration_slot_t val_slot;
    size_t val_len = sizeof(calibration_slot_t);
    err = nvs_get_blob(handle, next_slot == 0 ? NVS_KEY_SLOT_0 : NVS_KEY_SLOT_1, &val_slot, &val_len);
    if (err != ESP_OK || val_len != sizeof(calibration_slot_t) ||
        val_slot.magic != CALIBRATION_SLOT_HEADER_MAGIC ||
        val_slot.schema_version != CALIBRATION_RECORD_SCHEMA_VERSION ||
        val_slot.header_size != offsetof(calibration_slot_t, payload) ||
        val_slot.payload_size != sizeof(calibration_persist_payload_t) ||
        val_slot.generation != next_generation ||
        val_slot.profile_version != candidate->profile_version ||
        memcmp(val_slot.profile_id, candidate->profile_id, sizeof(val_slot.profile_id)) != 0 ||
        memcmp(val_slot.profile_hash, candidate->profile_hash, sizeof(val_slot.profile_hash)) != 0 ||
        calculate_crc32((const uint8_t *)&val_slot, offsetof(calibration_slot_t, crc32)) != val_slot.crc32) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_CORRUPT;
    }

    // 10. Write metadata
    calibration_meta_t new_meta;
    new_meta.magic = CALIBRATION_META_MAGIC;
    new_meta.schema_version = CALIBRATION_META_SCHEMA_VERSION;
    new_meta.active_slot = next_slot;
    new_meta.recalibration_required = 0;
    new_meta.reserved[0] = 0;
    new_meta.reserved[1] = 0;
    new_meta.active_generation = next_generation;

    err = write_and_verify_meta_locked(handle, &new_meta);
    if (err != ESP_OK) {
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    // 11. Read back committed record — metadata is now authoritative
    //     If reload fails here, the metadata commit already succeeded.
    //     Do NOT rollback; do NOT publish PASS. Report COMMIT_VERIFICATION_FAILED.
    cal_store_outcome_t reload_outcome = load_calibration_locked(handle, out_committed, NULL);
    if (reload_outcome != CAL_STORE_VALID) {
        if (out_snapshot) {
            memset(out_snapshot, 0, sizeof(calibration_store_snapshot_t));
            snprintf(out_snapshot->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN,
                     "%s", "COMMIT_VERIFICATION_FAILED");
            out_snapshot->recalibration_required = 1;
            out_snapshot->committed_record_valid = 0;
        }
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_COMMIT_VERIFICATION_FAILED;
    }

    // 12. Get final snapshot (load succeeded)
    cal_store_outcome_t snap_outcome = get_snapshot_locked(handle, out_snapshot);
    if (snap_outcome != CAL_STORE_VALID) {
        // Snapshot read failed after a valid reload — treat as verification failure
        if (out_snapshot) {
            snprintf(out_snapshot->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN,
                     "%s", "COMMIT_VERIFICATION_FAILED");
            out_snapshot->recalibration_required = 1;
            out_snapshot->committed_record_valid = 0;
        }
        nvs_close(handle);
        UNLOCK_STORE();
        return CAL_STORE_COMMIT_VERIFICATION_FAILED;
    }

    // Legacy Key cleanup after successful commit and verification
    nvs_erase_key(handle, NVS_KEY_HALL_BASELINE);
    nvs_erase_key(handle, NVS_KEY_HALL_DELTA);
    nvs_erase_key(handle, NVS_KEY_HALL_FULL_PRESS);
    nvs_erase_key(handle, NVS_KEY_REF_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_FULL);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_FULL);
    nvs_erase_key(handle, NVS_KEY_CALIBRATED);
    nvs_commit(handle);

    nvs_close(handle);
    UNLOCK_STORE();
    return CAL_STORE_VALID;
}

/**
 * @brief Set the recalibration_required flag in NVS.
 */
esp_err_t config_store_mark_recalibration_required(void)
{
    if (!s_config_store_initialized || s_store_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return err;
    }

    calibration_meta_t meta;
    cal_store_outcome_t meta_outcome = read_calibration_meta_locked(handle, &meta);
    if (meta_outcome == CAL_STORE_NOT_FOUND) {
        size_t len = 0;
        esp_err_t err0 = nvs_get_blob(handle, NVS_KEY_SLOT_0, NULL, &len);
        esp_err_t err1 = nvs_get_blob(handle, NVS_KEY_SLOT_1, NULL, &len);
        if (err0 != ESP_ERR_NVS_NOT_FOUND || err1 != ESP_ERR_NVS_NOT_FOUND) {
            nvs_close(handle);
            UNLOCK_STORE();
            return ESP_ERR_INVALID_STATE;
        }

        // Initialize fresh metadata
        memset(&meta, 0, sizeof(calibration_meta_t));
        meta.magic = CALIBRATION_META_MAGIC;
        meta.schema_version = CALIBRATION_META_SCHEMA_VERSION;
        meta.active_slot = CALIBRATION_SLOT_NONE;
        meta.recalibration_required = 1;
        meta.active_generation = 0;
    } else if (meta_outcome != CAL_STORE_VALID) {
        nvs_close(handle);
        UNLOCK_STORE();
        return ESP_ERR_INVALID_STATE;
    } else {
        meta.recalibration_required = 1;
    }

    err = write_and_verify_meta_locked(handle, &meta);
    nvs_close(handle);
    UNLOCK_STORE();
    return err;
}

/**
 * @brief Get the recalibration_required flag in NVS.
 */
cal_store_outcome_t config_store_get_recalibration_required(bool *out_required)
{
    if (out_required == NULL) {
        return CAL_STORE_IO_ERROR;
    }

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        *out_required = true;
        return CAL_STORE_IO_ERROR;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);
    if (err != ESP_OK) {
        *out_required = true;
        UNLOCK_STORE();
        if (err == ESP_ERR_NVS_NOT_FOUND) {
            return CAL_STORE_NOT_FOUND;
        }
        return CAL_STORE_IO_ERROR;
    }

    calibration_meta_t meta;
    cal_store_outcome_t outcome = read_calibration_meta_locked(handle, &meta);
    nvs_close(handle);

    if (outcome == CAL_STORE_VALID) {
        *out_required = (meta.recalibration_required == 1);
        UNLOCK_STORE();
        return CAL_STORE_VALID;
    }

    *out_required = true;
    UNLOCK_STORE();
    return outcome;
}

/* Locked snapshot generation */
static cal_store_outcome_t get_snapshot_locked(nvs_handle_t handle, calibration_store_snapshot_t *out)
{
    memset(out, 0, sizeof(calibration_store_snapshot_t));
    snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
    out->recalibration_required = 1;
    out->committed_record_valid = 0;



    calibration_config_t config;
    calibration_meta_t meta;
    cal_store_outcome_t outcome = load_calibration_locked(handle, &config, &meta);

    if (outcome == CAL_STORE_VALID) {
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "VALID");
        out->schema_version = config.calibration_schema_version;
        out->generation = config.calibration_generation;
        out->recalibration_required = meta.recalibration_required;
        out->committed_record_valid = 1;
        snprintf(out->profile_id, sizeof(out->profile_id), "%s", config.profile_id);
        out->profile_version = config.profile_version;
        snprintf(out->profile_hash, sizeof(out->profile_hash), "%s", config.profile_hash);
        return CAL_STORE_VALID;
    }

    // Check slot blobs (size-probe only, no full read needed here)
    size_t probe_s0 = 0, probe_s1 = 0;
    esp_err_t e0 = nvs_get_blob(handle, NVS_KEY_SLOT_0, NULL, &probe_s0);
    esp_err_t e1 = nvs_get_blob(handle, NVS_KEY_SLOT_1, NULL, &probe_s1);
    bool slots_exist = (e0 != ESP_ERR_NVS_NOT_FOUND) || (e1 != ESP_ERR_NVS_NOT_FOUND);

    // Check legacy
    int32_t dummy_hall = 0;
    bool legacy_exists = (nvs_get_i32(handle, NVS_KEY_HALL_DELTA, &dummy_hall) == ESP_OK);

    out->committed_record_valid = 0;
    out->generation = 0;
    out->profile_id[0] = '\0';
    out->profile_version = 0;
    out->profile_hash[0] = '\0';

    if (outcome == CAL_STORE_NOT_FOUND) {
        if (!slots_exist) {
            if (legacy_exists) {
                snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "LEGACY_UNVERIFIED");
            } else {
                snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "MISSING");
            }
        } else {
            snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "CORRUPT");
        }
        out->schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
        out->recalibration_required = 1;
        return outcome;
    }

    if (outcome == CAL_STORE_CORRUPT) {
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "CORRUPT");
        out->schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
        out->recalibration_required = 1;
        return outcome;
    }

    if (outcome == CAL_STORE_UNSUPPORTED_SCHEMA) {
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNSUPPORTED_SCHEMA");
        // Read meta schema version if available
        calibration_meta_t raw_meta;
        memset(&raw_meta, 0, sizeof(raw_meta));
        size_t meta_len = sizeof(calibration_meta_t);
        if (nvs_get_blob(handle, NVS_KEY_CAL_META, &raw_meta, &meta_len) == ESP_OK &&
            meta_len == sizeof(calibration_meta_t) &&
            raw_meta.magic == CALIBRATION_META_MAGIC) {
            out->schema_version = raw_meta.schema_version;
        } else {
            out->schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
        }
        out->recalibration_required = 1;
        return outcome;
    }

    if (outcome == CAL_STORE_IO_ERROR) {
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        out->schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
        out->recalibration_required = 1;
        return outcome;
    }

    if (outcome == CAL_STORE_COMMIT_VERIFICATION_FAILED) {
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "COMMIT_VERIFICATION_FAILED");
        out->schema_version = CALIBRATION_RECORD_SCHEMA_VERSION;
        out->recalibration_required = 1;
        return outcome;
    }

    return outcome;
}

/**
 * @brief Get calibration store snapshot.
 */
cal_store_outcome_t config_store_get_snapshot(calibration_store_snapshot_t *out)
{
    if (out == NULL) {
        return CAL_STORE_IO_ERROR;
    }

    if (!s_config_store_initialized || s_store_mutex == NULL) {
        memset(out, 0, sizeof(calibration_store_snapshot_t));
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        out->recalibration_required = 1;
        out->committed_record_valid = 0;
        return CAL_STORE_IO_ERROR;
    }

    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READONLY, &handle);
    if (err != ESP_OK) {
        memset(out, 0, sizeof(calibration_store_snapshot_t));
        snprintf(out->calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
        out->recalibration_required = 1;
        out->committed_record_valid = 0;
        UNLOCK_STORE();
        return CAL_STORE_IO_ERROR;
    }

    cal_store_outcome_t outcome = get_snapshot_locked(handle, out);
    nvs_close(handle);

    UNLOCK_STORE();
    return outcome;
}



/**
 * @brief Clear only network/provisioning values.
 */
esp_err_t config_store_clear_network(void)
{
    if (!s_config_store_initialized || s_store_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return err;
    }

    nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
    nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
    nvs_erase_key(handle, NVS_KEY_REGISTER_URL);
    nvs_erase_key(handle, NVS_KEY_BACKEND_BASE_URL);
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_BACKEND_REGISTERED);
    nvs_erase_key(handle, NVS_KEY_DEVICE_ID);
    nvs_erase_key(handle, NVS_KEY_PROVISIONED);

    err = nvs_commit(handle);
    nvs_close(handle);

    UNLOCK_STORE();
    return err;
}

/* Locked clear of calibration and legacy keys */
static esp_err_t clear_calibration_locked(nvs_handle_t handle)
{
    nvs_erase_key(handle, NVS_KEY_SLOT_0);
    nvs_erase_key(handle, NVS_KEY_SLOT_1);
    nvs_erase_key(handle, NVS_KEY_CAL_META);

    nvs_erase_key(handle, NVS_KEY_HALL_BASELINE);
    nvs_erase_key(handle, NVS_KEY_HALL_DELTA);
    nvs_erase_key(handle, NVS_KEY_HALL_FULL_PRESS);
    nvs_erase_key(handle, NVS_KEY_REF_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_PRESSURE);
    nvs_erase_key(handle, NVS_KEY_BLADDER1_FULL);
    nvs_erase_key(handle, NVS_KEY_BLADDER2_FULL);
    nvs_erase_key(handle, NVS_KEY_CALIBRATED);

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



    return nvs_commit(handle);
}

/**
 * @brief Clear only calibration values.
 */
esp_err_t config_store_clear_calibration(void)
{
    if (!s_config_store_initialized || s_store_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return err;
    }

    err = clear_calibration_locked(handle);
    nvs_close(handle);

    UNLOCK_STORE();
    return err;
}

/**
 * @brief Clear network and calibration values.
 */
esp_err_t config_store_clear_all(void)
{
    if (!s_config_store_initialized || s_store_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    LOCK_STORE();

    nvs_handle_t handle;
    esp_err_t err = config_store_open(NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        UNLOCK_STORE();
        return err;
    }

    nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
    nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
    nvs_erase_key(handle, NVS_KEY_REGISTER_URL);
    nvs_erase_key(handle, NVS_KEY_BACKEND_BASE_URL);
    nvs_erase_key(handle, NVS_KEY_MQTT_HOST);
    nvs_erase_key(handle, NVS_KEY_MQTT_PORT);
    nvs_erase_key(handle, NVS_KEY_BACKEND_REGISTERED);
    nvs_erase_key(handle, NVS_KEY_DEVICE_ID);
    nvs_erase_key(handle, NVS_KEY_PROVISIONED);
    nvs_commit(handle);

    err = clear_calibration_locked(handle);
    nvs_close(handle);

    UNLOCK_STORE();
    return err;
}
