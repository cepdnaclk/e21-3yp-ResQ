#include "adc_shared_service.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_log.h"

#include "board_config.h"

static const char *TAG = "adc_shared_service";

static adc_oneshot_unit_handle_t s_adc_handle = NULL;
static adc_cali_handle_t s_cali_handle = NULL;
static bool s_initialized = false;
static bool s_cali_enabled = false;
static SemaphoreHandle_t s_adc_mutex = NULL;

static esp_err_t adc_shared_create_calibration(void)
{
    // Calibration optional - leave disabled by default.
    s_cali_enabled = false;
    s_cali_handle = NULL;
    return ESP_OK;
}

esp_err_t adc_shared_service_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    if (s_adc_mutex == NULL) {
        s_adc_mutex = xSemaphoreCreateMutex();
        if (s_adc_mutex == NULL) {
            ESP_LOGE(TAG, "Failed to create ADC mutex");
            return ESP_ERR_NO_MEM;
        }
    }

    if (xSemaphoreTake(s_adc_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGE(TAG, "ADC mutex timeout during init");
        return ESP_ERR_TIMEOUT;
    }

    if (s_initialized) {
        xSemaphoreGive(s_adc_mutex);
        return ESP_OK;
    }

    adc_oneshot_unit_init_cfg_t init_config = {
        .unit_id = ADC_UNIT_1,
    };

    esp_err_t err = adc_oneshot_new_unit(&init_config, &s_adc_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_oneshot_new_unit failed: %s", esp_err_to_name(err));
        s_adc_handle = NULL;
        xSemaphoreGive(s_adc_mutex);
        return err;
    }

    adc_oneshot_chan_cfg_t chan_config = {
        .bitwidth = ADC_BITWIDTH_DEFAULT,
        .atten = ADC_ATTEN_DB_12,
    };

    err = adc_oneshot_config_channel(s_adc_handle, BOARD_HALL_ADC_CHAN, &chan_config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "adc_oneshot_config_channel failed for Hall channel: %s", esp_err_to_name(err));
        adc_oneshot_del_unit(s_adc_handle);
        s_adc_handle = NULL;
        xSemaphoreGive(s_adc_mutex);
        return err;
    }

    adc_shared_create_calibration();

    s_initialized = true;

    ESP_LOGI(TAG, "Shared ADC service initialized for Hall channel");
    xSemaphoreGive(s_adc_mutex);
    return ESP_OK;
}

esp_err_t adc_shared_service_read_hall_raw(int *out_raw)
{
    if (out_raw == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized) {
        esp_err_t init_err = adc_shared_service_init();
        if (init_err != ESP_OK) {
            return init_err;
        }
    }

    if (xSemaphoreTake(s_adc_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGW(TAG, "ADC mutex timeout during Hall read");
        return ESP_ERR_TIMEOUT;
    }

    int raw = 0;
    esp_err_t err = adc_oneshot_read(s_adc_handle, BOARD_HALL_ADC_CHAN, &raw);
    xSemaphoreGive(s_adc_mutex);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Hall ADC read failed: %s", esp_err_to_name(err));
        return err;
    }

    *out_raw = raw;
    return ESP_OK;
}

esp_err_t adc_shared_service_read_hall_mv(int *out_mv)
{
    if (out_mv == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    int raw = 0;
    esp_err_t err = adc_shared_service_read_hall_raw(&raw);
    if (err != ESP_OK) {
        return err;
    }

    if (s_cali_enabled && s_cali_handle != NULL) {
        err = adc_cali_raw_to_voltage(s_cali_handle, raw, out_mv);
        if (err == ESP_OK) {
            return ESP_OK;
        }
    }

    // Fallback: return raw when calibration unavailable
    *out_mv = raw;
    return ESP_OK;
}

esp_err_t adc_shared_service_read_hall_average(int sample_count, int delay_ms, int *out_avg)
{
    if (out_avg == NULL || sample_count <= 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int64_t sum = 0;
    int valid = 0;

    for (int i = 0; i < sample_count; i++) {
        int raw = 0;
        esp_err_t err = adc_shared_service_read_hall_raw(&raw);
        if (err == ESP_OK) {
            sum += raw;
            valid++;
        }

        if (delay_ms > 0) {
            vTaskDelay(pdMS_TO_TICKS(delay_ms));
        }
    }

    if (valid == 0) {
        return ESP_FAIL;
    }

    *out_avg = (int)(sum / valid);
    return ESP_OK;
}

bool adc_shared_service_is_initialized(void)
{
    return s_initialized;
}

esp_err_t adc_shared_service_deinit(void)
{
    if (s_adc_mutex == NULL) {
        return ESP_OK;
    }

    if (xSemaphoreTake(s_adc_mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_cali_handle != NULL) {
        s_cali_handle = NULL;
        s_cali_enabled = false;
    }

    if (s_adc_handle != NULL) {
        adc_oneshot_del_unit(s_adc_handle);
        s_adc_handle = NULL;
    }

    s_initialized = false;

    xSemaphoreGive(s_adc_mutex);
    return ESP_OK;
}
