#include "hx710.h"
#include "hx710_test.h"

#include "esp_log.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "io_mode_manager.h"
#include "soc/soc_caps.h"

#if SOC_USB_SERIAL_JTAG_SUPPORTED
#include "hal/usb_serial_jtag_ll.h"
#endif

#if (defined(CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG) && \
     CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG) || \
    (defined(CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG) && \
     CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG)
#error "Legacy HX710 USB-pad protection requires native USB Serial/JTAG console output to be disabled"
#endif

#define HX710_MUTEX_TIMEOUT_MS 200u
static const char *TAG = "hx710";

static SemaphoreHandle_t s_hx710_mutex;
static StaticSemaphore_t s_hx710_mutex_storage;
static portMUX_TYPE s_hx710_init_lock = portMUX_INITIALIZER_UNLOCKED;
static bool s_sck_owned;
static gpio_num_t s_owned_sck = GPIO_NUM_NC;

static esp_err_t default_reset_pin(gpio_num_t pin)
{
    return gpio_reset_pin(pin);
}

static esp_err_t default_gpio_config(const gpio_config_t *config)
{
    return gpio_config(config);
}

static esp_err_t default_set_level(gpio_num_t pin, uint32_t level)
{
    return gpio_set_level(pin, level);
}

static int default_get_level(gpio_num_t pin)
{
    return gpio_get_level(pin);
}

static void default_delay_us(uint32_t delay_us)
{
    esp_rom_delay_us(delay_us);
}

static int64_t default_get_time_us(void)
{
    return esp_timer_get_time();
}

static TickType_t default_get_tick_count(void)
{
    return xTaskGetTickCount();
}

static void default_task_delay(TickType_t ticks)
{
    vTaskDelay(ticks);
}

static const hx710_test_io_ops_t s_default_io_ops = {
    .reset_pin = default_reset_pin,
    .config = default_gpio_config,
    .set_level = default_set_level,
    .get_level = default_get_level,
    .delay_us = default_delay_us,
    .get_time_us = default_get_time_us,
    .get_tick_count = default_get_tick_count,
    .task_delay = default_task_delay,
};

static hx710_test_io_ops_t s_io_ops = {
    .reset_pin = default_reset_pin,
    .config = default_gpio_config,
    .set_level = default_set_level,
    .get_level = default_get_level,
    .delay_us = default_delay_us,
    .get_time_us = default_get_time_us,
    .get_tick_count = default_get_tick_count,
    .task_delay = default_task_delay,
};

static void hx710_ensure_mutex(void)
{
    taskENTER_CRITICAL(&s_hx710_init_lock);
    if (s_hx710_mutex == NULL) {
        s_hx710_mutex = xSemaphoreCreateMutexStatic(&s_hx710_mutex_storage);
    }
    taskEXIT_CRITICAL(&s_hx710_init_lock);
}

static bool hx710_take_mutex(void)
{
    hx710_ensure_mutex();
    return s_hx710_mutex != NULL &&
           xSemaphoreTake(s_hx710_mutex,
                          pdMS_TO_TICKS(HX710_MUTEX_TIMEOUT_MS)) == pdTRUE;
}

static int32_t hx710_sign_extend_24(uint32_t raw)
{
    if ((raw & 0x800000u) != 0) {
        raw |= 0xff000000u;
    }
    return (int32_t)raw;
}

static void hx710_reset_group_status(hx710_group_result_t *result)
{
    /*
     * Deliberately do not touch result->raw here. They are committed only
     * after all 25 clocks complete; captured_raw_mask then distinguishes
     * diagnostic capture from decision-valid output.
     */
    result->error = ESP_FAIL;
    result->cleanup_error = ESP_OK;
    result->initial_ready_mask = 0;
    result->ready_mask = 0;
    result->captured_raw_mask = 0;
    result->valid_mask = 0;
    result->not_ready_mask = 0;
    result->stuck_high_mask = 0;
    result->stuck_low_mask = 0;
    result->post_read_invalid_mask = 0;
    result->observed_next_ready_mask = 0;
    result->early_next_ready_warning_mask = 0;
    result->pulse_count = 0;
    result->ready_wait_ms = 0;
    result->post_read_started_us = -1;
    for (size_t channel = 0; channel < HX710_CHANNEL_COUNT; ++channel) {
        result->first_next_ready_low_us[channel] = -1;
    }
}

static uint8_t hx710_read_level_mask(const gpio_num_t dout_pins[3])
{
    uint8_t low_mask = 0;
    for (size_t i = 0; i < HX710_CHANNEL_COUNT; ++i) {
        if (s_io_ops.get_level(dout_pins[i]) == 0) {
            low_mask |= (uint8_t)(1u << i);
        }
    }
    return low_mask;
}

static esp_err_t hx710_require_owned_locked(gpio_num_t sck_pin)
{
    if (!io_mode_manager_is_sensor() || !s_sck_owned ||
        s_owned_sck != sck_pin) {
        return ESP_ERR_INVALID_STATE;
    }
    return ESP_OK;
}

static esp_err_t hx710_force_sck_low_locked(gpio_num_t sck_pin)
{
    esp_err_t err = hx710_require_owned_locked(sck_pin);
    if (err != ESP_OK) {
        return err;
    }
    err = s_io_ops.set_level(sck_pin, 0);
    if (err != ESP_OK) {
        return err;
    }
    s_io_ops.delay_us(1);
    return s_io_ops.get_level(sck_pin) == 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t hx710_set_test_io_ops(const hx710_test_io_ops_t *ops)
{
    if (ops == NULL || ops->reset_pin == NULL || ops->config == NULL ||
        ops->set_level == NULL || ops->get_level == NULL ||
        ops->delay_us == NULL || ops->get_time_us == NULL ||
        ops->get_tick_count == NULL ||
        ops->task_delay == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    s_io_ops = *ops;
    return ESP_OK;
}

void hx710_reset_test_io_ops(void)
{
    s_io_ops = s_default_io_ops;
}

void hx710_reset_state_for_test(void)
{
    s_sck_owned = false;
    s_owned_sck = GPIO_NUM_NC;
}

bool hx710_sck_is_owned_by_sensor(void)
{
    return s_sck_owned && io_mode_manager_is_sensor();
}

esp_err_t hx710_sck_acquire_for_sensor_mode(gpio_num_t sck_pin)
{
    if (!io_mode_manager_is_sensor()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin)) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!hx710_take_mutex()) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t err = ESP_OK;
    if (s_sck_owned) {
        err = s_owned_sck == sck_pin
                  ? hx710_force_sck_low_locked(sck_pin)
                  : ESP_ERR_INVALID_STATE;
        xSemaphoreGive(s_hx710_mutex);
        return err;
    }

#if SOC_USB_SERIAL_JTAG_SUPPORTED
    /*
     * Retain the legacy USB-pad isolation sequence used by SENSOR mode.
     * The active shared-SCK GPIO is supplied by board_config rather than
     * hardcoded here. USB mode restores the PHY on the controlled reboot.
     */
    usb_serial_jtag_ll_phy_enable_pad(false);
#endif

    /*
     * Preload the GPIO output register before enabling output. Unlike
     * gpio_reset_pin(), this never introduces a pull-up/high-impedance interval.
     */
    err = s_io_ops.set_level(sck_pin, 0);
    if (err == ESP_OK) {
        const gpio_config_t config = {
            .pin_bit_mask = 1ULL << sck_pin,
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        err = s_io_ops.config(&config);
    }
    if (err == ESP_OK) {
        s_io_ops.delay_us(10);
        err = s_io_ops.get_level(sck_pin) == 0 ? ESP_OK : ESP_FAIL;
    }
    if (err == ESP_OK) {
        s_owned_sck = sck_pin;
        s_sck_owned = true;
    }

    xSemaphoreGive(s_hx710_mutex);
    return err;
}

esp_err_t hx710_prepare_shared_sck(gpio_num_t sck_pin)
{
    return hx710_sck_acquire_for_sensor_mode(sck_pin);
}

esp_err_t hx710_sck_release_for_usb_mode(void)
{
    if (!io_mode_manager_is_sensor()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!hx710_take_mutex()) {
        return ESP_ERR_TIMEOUT;
    }
    if (!s_sck_owned) {
        xSemaphoreGive(s_hx710_mutex);
        return ESP_OK;
    }

    gpio_num_t sck_pin = s_owned_sck;
    esp_err_t err = hx710_force_sck_low_locked(sck_pin);
    if (err == ESP_OK) {
        const gpio_config_t release_config = {
            .pin_bit_mask = 1ULL << sck_pin,
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        err = s_io_ops.config(&release_config);
    }
    if (err == ESP_OK) {
        s_sck_owned = false;
        s_owned_sck = GPIO_NUM_NC;
    }

    xSemaphoreGive(s_hx710_mutex);
    return err;
}

esp_err_t hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
    if (!io_mode_manager_is_sensor()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin) ||
        !GPIO_IS_VALID_GPIO(dout_pin) || sck_pin == dout_pin) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!hx710_take_mutex()) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t err = hx710_require_owned_locked(sck_pin);
    if (err == ESP_OK) {
        const gpio_config_t dout_config = {
            .pin_bit_mask = 1ULL << dout_pin,
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        err = s_io_ops.config(&dout_config);
    }

    xSemaphoreGive(s_hx710_mutex);
    return err;
}

esp_err_t hx710_hold_sck_low(gpio_num_t sck_pin)
{
    if (!io_mode_manager_is_sensor()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin)) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!hx710_take_mutex()) {
        return ESP_ERR_TIMEOUT;
    }
    esp_err_t err = hx710_force_sck_low_locked(sck_pin);
    xSemaphoreGive(s_hx710_mutex);
    return err;
}

int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
    int32_t raw = 0;
    return hx710_read_single(sck_pin, dout_pin, &raw, NULL, NULL) == ESP_OK
               ? raw
               : HX710_ERROR_TIMEOUT;
}

esp_err_t hx710_read_single(gpio_num_t sck_pin,
                            gpio_num_t dout_pin,
                            int32_t *out_raw,
                            uint32_t *out_wait_ms,
                            uint8_t *out_pulse_count)
{
    if (out_wait_ms != NULL) {
        *out_wait_ms = 0;
    }
    if (out_pulse_count != NULL) {
        *out_pulse_count = 0;
    }
    if (out_raw == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!io_mode_manager_is_sensor()) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin) ||
        !GPIO_IS_VALID_GPIO(dout_pin) || sck_pin == dout_pin) {
        return ESP_ERR_INVALID_ARG;
    }
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t hx710_read_group_shared_sck(gpio_num_t sck_pin,
                                      gpio_num_t dout0_pin,
                                      gpio_num_t dout1_pin,
                                      gpio_num_t dout2_pin,
                                      hx710_group_result_t *out_result)
{
    if (out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    hx710_reset_group_status(out_result);

    if (!io_mode_manager_is_sensor()) {
        out_result->error = ESP_ERR_INVALID_STATE;
        return out_result->error;
    }
    if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin) ||
        !GPIO_IS_VALID_GPIO(dout0_pin) ||
        !GPIO_IS_VALID_GPIO(dout1_pin) ||
        !GPIO_IS_VALID_GPIO(dout2_pin) ||
        sck_pin == dout0_pin || sck_pin == dout1_pin ||
        sck_pin == dout2_pin || dout0_pin == dout1_pin ||
        dout0_pin == dout2_pin || dout1_pin == dout2_pin) {
        out_result->error = ESP_ERR_INVALID_ARG;
        return out_result->error;
    }
    if (!hx710_take_mutex()) {
        out_result->error = ESP_ERR_TIMEOUT;
        return out_result->error;
    }

    const gpio_num_t dout_pins[3] = {
        dout0_pin,
        dout1_pin,
        dout2_pin,
    };
    uint32_t raw[3] = {0, 0, 0};
    esp_err_t err = hx710_force_sck_low_locked(sck_pin);
    if (err != ESP_OK) {
        goto cleanup;
    }

    TickType_t ready_started = s_io_ops.get_tick_count();
    const TickType_t ready_timeout_ticks =
        pdMS_TO_TICKS(HX710_READY_TIMEOUT_MS);
    out_result->initial_ready_mask = hx710_read_level_mask(dout_pins);
    out_result->ready_mask = out_result->initial_ready_mask;

    while (out_result->ready_mask != HX710_VALID_CHANNEL_ALL) {
        if ((s_io_ops.get_tick_count() - ready_started) >=
            ready_timeout_ticks) {
            out_result->not_ready_mask =
                HX710_VALID_CHANNEL_ALL & ~out_result->ready_mask;
            out_result->stuck_high_mask = out_result->not_ready_mask;
            err = ESP_ERR_TIMEOUT;
            goto cleanup;
        }
        s_io_ops.task_delay(pdMS_TO_TICKS(1));
        out_result->ready_mask = hx710_read_level_mask(dout_pins);
    }
    out_result->ready_wait_ms = (uint32_t)pdTICKS_TO_MS(
        s_io_ops.get_tick_count() - ready_started);

    for (int bit = 0; bit < 24; ++bit) {
        for (size_t channel = 0; channel < HX710_CHANNEL_COUNT; ++channel) {
            raw[channel] <<= 1;
        }

        err = s_io_ops.set_level(sck_pin, 1);
        if (err != ESP_OK) {
            goto cleanup;
        }
        s_io_ops.delay_us(1);

        for (size_t channel = 0; channel < HX710_CHANNEL_COUNT; ++channel) {
            if (s_io_ops.get_level(dout_pins[channel]) != 0) {
                raw[channel] |= 1u;
            }
        }

        err = s_io_ops.set_level(sck_pin, 0);
        if (err != ESP_OK) {
            goto cleanup;
        }
        out_result->pulse_count++;
        s_io_ops.delay_us(1);
    }

    err = s_io_ops.set_level(sck_pin, 1);
    if (err != ESP_OK) {
        goto cleanup;
    }
    s_io_ops.delay_us(1);
    err = s_io_ops.set_level(sck_pin, 0);
    if (err != ESP_OK) {
        goto cleanup;
    }
    out_result->pulse_count++;
    s_io_ops.delay_us(1);
    if (out_result->pulse_count != HX710_READ_PULSE_COUNT) {
        err = ESP_ERR_INVALID_RESPONSE;
        goto cleanup;
    }
    for (size_t channel = 0; channel < HX710_CHANNEL_COUNT; ++channel) {
        out_result->raw[channel] = hx710_sign_extend_24(raw[channel]);
    }
    out_result->captured_raw_mask = HX710_VALID_CHANNEL_ALL;

    /*
     * A completed read starts the next conversion and DOUT must return HIGH.
     * Remaining LOW here is the defining stuck-LOW false-success signature.
     */
    out_result->post_read_started_us = s_io_ops.get_time_us();
    uint8_t post_read_low_mask = hx710_read_level_mask(dout_pins);
    if (post_read_low_mask != 0) {
        out_result->stuck_low_mask = post_read_low_mask;
        out_result->post_read_invalid_mask = post_read_low_mask;
        err = ESP_ERR_INVALID_RESPONSE;
        goto cleanup;
    }

    /*
     * Best-effort, non-blocking diagnostic observation only. The mandatory
     * HIGH check above validated the completed transaction. If DOUT is already
     * LOW again now, it belongs to the following conversion and must not
     * invalidate the captured current sample.
     */
    out_result->observed_next_ready_mask =
        hx710_read_level_mask(dout_pins);
    out_result->early_next_ready_warning_mask =
        out_result->observed_next_ready_mask;
    if (out_result->observed_next_ready_mask != 0u) {
        int64_t elapsed_us =
            s_io_ops.get_time_us() - out_result->post_read_started_us;
        int32_t bounded_elapsed_us =
            elapsed_us > INT32_MAX ? INT32_MAX : (int32_t)elapsed_us;
        for (size_t channel = 0; channel < HX710_CHANNEL_COUNT;
             ++channel) {
            uint8_t bit = (uint8_t)(1u << channel);
            if ((out_result->observed_next_ready_mask & bit) != 0u) {
                out_result->first_next_ready_low_us[channel] =
                    bounded_elapsed_us;
            }
        }
        ESP_LOGD(TAG,
                 "HX710 early-next-ready observation: mask=0x%02X",
                 out_result->early_next_ready_warning_mask);
    }

    err = ESP_OK;

cleanup:
    out_result->cleanup_error = hx710_force_sck_low_locked(sck_pin);
    if (out_result->cleanup_error != ESP_OK) {
        ESP_LOGE(TAG, "Failed to restore shared HX710 SCK LOW: %s",
                 esp_err_to_name(out_result->cleanup_error));
        err = out_result->cleanup_error;
    }
    if (err == ESP_OK) {
        out_result->valid_mask = HX710_VALID_CHANNEL_ALL;
    } else {
        out_result->valid_mask = 0;
    }
    out_result->error = err;
    xSemaphoreGive(s_hx710_mutex);
    return err;
}

esp_err_t hx710_read_3_shared_sck_valid(gpio_num_t sck_pin,
                                       gpio_num_t dout0_pin,
                                       gpio_num_t dout1_pin,
                                       gpio_num_t dout2_pin,
                                       int32_t *out0,
                                       int32_t *out1,
                                       int32_t *out2,
                                       uint8_t *out_valid_mask)
{
    if (out0 == NULL || out1 == NULL || out2 == NULL ||
        out_valid_mask == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    *out_valid_mask = 0;

    hx710_group_result_t result;
    esp_err_t err = hx710_read_group_shared_sck(
        sck_pin, dout0_pin, dout1_pin, dout2_pin, &result);
    if (err == ESP_OK && result.valid_mask == HX710_VALID_CHANNEL_ALL) {
        *out0 = result.raw[0];
        *out1 = result.raw[1];
        *out2 = result.raw[2];
        *out_valid_mask = result.valid_mask;
    }
    return err;
}

esp_err_t hx710_read_3_shared_sck(gpio_num_t sck_pin,
                                  gpio_num_t dout0_pin,
                                  gpio_num_t dout1_pin,
                                  gpio_num_t dout2_pin,
                                  int32_t *out0,
                                  int32_t *out1,
                                  int32_t *out2)
{
    uint8_t valid_mask = 0;
    esp_err_t err = hx710_read_3_shared_sck_valid(
        sck_pin, dout0_pin, dout1_pin, dout2_pin,
        out0, out1, out2, &valid_mask);
    if (err != ESP_OK) {
        return err;
    }
    return valid_mask == HX710_VALID_CHANNEL_ALL
               ? ESP_OK
               : ESP_ERR_INVALID_RESPONSE;
}
