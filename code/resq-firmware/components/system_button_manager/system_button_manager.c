#include "system_button_manager.h"

#include <stdbool.h>

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "board_config.h"

static const char *TAG = "system_buttons";

#ifndef BUTTON_1
#define BUTTON_1 GPIO_NUM_9
#endif

#ifndef BUTTON_2
#define BUTTON_2 GPIO_NUM_1
#endif

#define SYSTEM_LONG_PRESS_MS 3000

static bool s_initialized = false;

static int64_t s_button_1_pressed_since_ms = 0;
static int64_t s_button_2_pressed_since_ms = 0;

static bool button_is_pressed(gpio_num_t gpio)
{
    /*
     * Assumption:
     * Buttons use pull-up and become LOW when pressed.
     */
    return gpio_get_level(gpio) == 0;
}

esp_err_t system_button_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_1) | (1ULL << BUTTON_2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure system buttons: %s", esp_err_to_name(err));
        return err;
    }

    s_button_1_pressed_since_ms = 0;
    s_button_2_pressed_since_ms = 0;
    s_initialized = true;

    ESP_LOGI(TAG, "System button manager initialized");

    return ESP_OK;
}

system_button_action_t system_button_manager_poll(resq_state_t current_state)
{
    if (!s_initialized) {
        return SYSTEM_BUTTON_ACTION_NONE;
    }

    /*
     * ERROR and CALIBRATION_FAIL own the buttons themselves.
     * Do not apply global button behavior in those recovery states.
     */
    if (current_state == RESQ_STATE_ERROR ||
        current_state == RESQ_STATE_CALIBRATION_FAIL ||
        current_state == RESQ_STATE_RESETTING ||
        current_state == RESQ_STATE_TURN_OFF) {
        s_button_1_pressed_since_ms = 0;
        s_button_2_pressed_since_ms = 0;
        return SYSTEM_BUTTON_ACTION_NONE;
    }

    int64_t now_ms = esp_timer_get_time() / 1000;

    bool b1_pressed = button_is_pressed(BUTTON_1);
    bool b2_pressed = button_is_pressed(BUTTON_2);

    if (b1_pressed) {
        if (s_button_1_pressed_since_ms == 0) {
            s_button_1_pressed_since_ms = now_ms;
        }
    } else {
        s_button_1_pressed_since_ms = 0;
    }

    if (b2_pressed) {
        if (s_button_2_pressed_since_ms == 0) {
            s_button_2_pressed_since_ms = now_ms;
        }
    } else {
        s_button_2_pressed_since_ms = 0;
    }

    /*
    * Priority rule:
    * If both buttons are held long enough at the same time,
    * BUTTON_2 / FACTORY_RESET has higher priority than BUTTON_1 / TURN_OFF.
    */
    if (s_button_2_pressed_since_ms != 0 &&
        (now_ms - s_button_2_pressed_since_ms) >= SYSTEM_LONG_PRESS_MS) {
        ESP_LOGW(TAG, "BUTTON_2 long press detected: FACTORY_RESET");
        s_button_1_pressed_since_ms = 0;
        s_button_2_pressed_since_ms = 0;
        return SYSTEM_BUTTON_ACTION_FACTORY_RESET;
    }

    if (s_button_1_pressed_since_ms != 0 &&
        (now_ms - s_button_1_pressed_since_ms) >= SYSTEM_LONG_PRESS_MS) {
        ESP_LOGW(TAG, "BUTTON_1 long press detected: TURN_OFF");
        s_button_1_pressed_since_ms = 0;
        s_button_2_pressed_since_ms = 0;
        return SYSTEM_BUTTON_ACTION_TURN_OFF;
    }

    return SYSTEM_BUTTON_ACTION_NONE;
}
