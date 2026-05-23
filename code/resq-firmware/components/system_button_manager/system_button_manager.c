#include "system_button_manager.h"

#include <stdbool.h>
#include <stdint.h>

#include "driver/gpio.h"
#include "esp_attr.h"
#include "esp_err.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "board_config.h"

static const char *TAG = "system_buttons";

#ifndef BUTTON_1
#define BUTTON_1 GPIO_NUM_9
#endif

#ifndef BUTTON_2
#define BUTTON_2 GPIO_NUM_1
#endif

#define SYSTEM_BUTTON_ACTIVE_LEVEL          0
#define SYSTEM_BUTTON_DEBOUNCE_MS           50
#define SYSTEM_BUTTON_LONG_PRESS_MS         3000
#define SYSTEM_BUTTON_TASK_POLL_MS          20
#define SYSTEM_BUTTON_EDGE_QUEUE_LEN        16
#define SYSTEM_BUTTON_ACTION_QUEUE_LEN      4
#define SYSTEM_BUTTON_TASK_STACK_WORDS      3072
#define SYSTEM_BUTTON_TASK_PRIORITY         10

typedef struct {
    gpio_num_t gpio;
} button_edge_event_t;

typedef struct {
    gpio_num_t gpio;
    bool pressed;
    bool long_sent;
    TickType_t press_start_tick;
} button_runtime_t;

static bool s_initialized = false;
static QueueHandle_t s_edge_queue = NULL;
static QueueHandle_t s_action_queue = NULL;
static TaskHandle_t s_button_task_handle = NULL;

static button_runtime_t s_button_1 = {
    .gpio = BUTTON_1,
    .pressed = false,
    .long_sent = false,
    .press_start_tick = 0,
};

static button_runtime_t s_button_2 = {
    .gpio = BUTTON_2,
    .pressed = false,
    .long_sent = false,
    .press_start_tick = 0,
};

static bool button_is_pressed(gpio_num_t gpio)
{
    return gpio_get_level(gpio) == SYSTEM_BUTTON_ACTIVE_LEVEL;
}

static button_runtime_t *button_runtime_for_gpio(gpio_num_t gpio)
{
    if (gpio == BUTTON_1) {
        return &s_button_1;
    }

    if (gpio == BUTTON_2) {
        return &s_button_2;
    }

    return NULL;
}

static system_button_action_t action_for_gpio(gpio_num_t gpio)
{
    if (gpio == BUTTON_1) {
        return SYSTEM_BUTTON_ACTION_TURN_OFF;
    }

    if (gpio == BUTTON_2) {
        return SYSTEM_BUTTON_ACTION_FACTORY_RESET;
    }

    return SYSTEM_BUTTON_ACTION_NONE;
}

const char *system_button_action_to_string(system_button_action_t action)
{
    switch (action) {
    case SYSTEM_BUTTON_ACTION_TURN_OFF:
        return "TURN_OFF";
    case SYSTEM_BUTTON_ACTION_FACTORY_RESET:
        return "FACTORY_RESET";
    case SYSTEM_BUTTON_ACTION_NONE:
    default:
        return "NONE";
    }
}

static bool turn_off_allowed_in_state(resq_state_t state)
{
    switch (state) {
    case RESQ_STATE_PROVISIONING:
    case RESQ_STATE_PAIRED_IDLE:
    case RESQ_STATE_READY_FOR_SESSION:
    case RESQ_STATE_CALIBRATING:
    case RESQ_STATE_SESSION_ACTIVE:
        return true;

    default:
        return false;
    }
}

static bool factory_reset_allowed_in_state(resq_state_t state)
{
    switch (state) {
    case RESQ_STATE_PAIRED_IDLE:
    case RESQ_STATE_READY_FOR_SESSION:
    case RESQ_STATE_CALIBRATING:
    case RESQ_STATE_SESSION_ACTIVE:
        return true;

    default:
        return false;
    }
}

static bool action_allowed_in_state(resq_state_t state, system_button_action_t action)
{
    if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
        return turn_off_allowed_in_state(state);
    }

    if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
        return factory_reset_allowed_in_state(state);
    }

    return false;
}

static void IRAM_ATTR button_gpio_isr(void *arg)
{
    gpio_num_t gpio = (gpio_num_t)(intptr_t)arg;

    button_edge_event_t event = {
        .gpio = gpio,
    };

    BaseType_t higher_priority_task_woken = pdFALSE;

    if (s_edge_queue != NULL) {
        xQueueSendFromISR(s_edge_queue, &event, &higher_priority_task_woken);
    }

    if (higher_priority_task_woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

void system_button_manager_drain_actions(resq_state_t current_state)
{
    if (!s_initialized || s_action_queue == NULL) {
        return;
    }

    system_button_action_t candidate = SYSTEM_BUTTON_ACTION_NONE;

    while (xQueueReceive(s_action_queue, &candidate, 0) == pdTRUE) {
        if (candidate != SYSTEM_BUTTON_ACTION_NONE) {
            ESP_LOGW(TAG,
                     "Drained button action=%s in state=%s",
                     system_button_action_to_string(candidate),
                     resq_state_to_string(current_state));
        }
    }
}

static void publish_action_from_button(button_runtime_t *button)
{
    if (button == NULL || button->long_sent || !button->pressed) {
        return;
    }

    TickType_t now = xTaskGetTickCount();
    uint32_t held_ms = (uint32_t)((now - button->press_start_tick) * portTICK_PERIOD_MS);

    if (held_ms < SYSTEM_BUTTON_LONG_PRESS_MS) {
        return;
    }

    system_button_action_t action = action_for_gpio(button->gpio);
    if (action == SYSTEM_BUTTON_ACTION_NONE) {
        return;
    }

    if (xQueueSend(s_action_queue, &action, 0) != pdTRUE) {
        ESP_LOGW(TAG,
                 "Button action queue full; dropping action=%s",
                 system_button_action_to_string(action));
    } else {
        ESP_LOGW(TAG,
                 "Long press detected gpio=%d action=%s",
                 (int)button->gpio,
                 system_button_action_to_string(action));
    }

    button->long_sent = true;
}

static void update_button_state_from_edge(gpio_num_t gpio)
{
    button_runtime_t *button = button_runtime_for_gpio(gpio);
    if (button == NULL) {
        return;
    }

    /*
     * Debounce outside ISR.
     */
    vTaskDelay(pdMS_TO_TICKS(SYSTEM_BUTTON_DEBOUNCE_MS));

    bool pressed = button_is_pressed(gpio);
    TickType_t now = xTaskGetTickCount();

    if (pressed && !button->pressed) {
        button->pressed = true;
        button->long_sent = false;
        button->press_start_tick = now;

        ESP_LOGI(TAG, "Button press started gpio=%d", (int)gpio);
        return;
    }

    if (!pressed && button->pressed) {
        button->pressed = false;
        button->long_sent = false;
        button->press_start_tick = 0;

        ESP_LOGI(TAG, "Button released gpio=%d", (int)gpio);
        return;
    }
}

static void system_button_task(void *arg)
{
    (void)arg;

    button_edge_event_t edge = {0};

    while (true) {
        if (xQueueReceive(s_edge_queue,
                          &edge,
                          pdMS_TO_TICKS(SYSTEM_BUTTON_TASK_POLL_MS)) == pdTRUE) {
            update_button_state_from_edge(edge.gpio);
        }

        publish_action_from_button(&s_button_1);
        publish_action_from_button(&s_button_2);
    }
}

esp_err_t system_button_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    s_edge_queue = xQueueCreate(SYSTEM_BUTTON_EDGE_QUEUE_LEN,
                                sizeof(button_edge_event_t));
    if (s_edge_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create button edge queue");
        return ESP_ERR_NO_MEM;
    }

    s_action_queue = xQueueCreate(SYSTEM_BUTTON_ACTION_QUEUE_LEN,
                                  sizeof(system_button_action_t));
    if (s_action_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create button action queue");
        vQueueDelete(s_edge_queue);
        s_edge_queue = NULL;
        return ESP_ERR_NO_MEM;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BUTTON_1) | (1ULL << BUTTON_2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_ANYEDGE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to configure system buttons: %s", esp_err_to_name(err));
        return err;
    }

    /*
     * gpio_install_isr_service() returns ESP_ERR_INVALID_STATE if the ISR
     * service was already installed by another component. That is acceptable.
     */
    err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "Failed to install GPIO ISR service: %s", esp_err_to_name(err));
        return err;
    }

    err = gpio_isr_handler_add(BUTTON_1, button_gpio_isr, (void *)(intptr_t)BUTTON_1);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add BUTTON_1 ISR handler: %s", esp_err_to_name(err));
        return err;
    }

    err = gpio_isr_handler_add(BUTTON_2, button_gpio_isr, (void *)(intptr_t)BUTTON_2);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add BUTTON_2 ISR handler: %s", esp_err_to_name(err));
        return err;
    }

    BaseType_t task_ok = xTaskCreate(system_button_task,
                                     "system_buttons",
                                     SYSTEM_BUTTON_TASK_STACK_WORDS,
                                     NULL,
                                     SYSTEM_BUTTON_TASK_PRIORITY,
                                     &s_button_task_handle);
    if (task_ok != pdPASS) {
        ESP_LOGE(TAG, "Failed to create system button task");
        return ESP_ERR_NO_MEM;
    }

    s_initialized = true;

    ESP_LOGI(TAG,
             "System button manager initialized with GPIO interrupts BUTTON_1=%d BUTTON_2=%d",
             (int)BUTTON_1,
             (int)BUTTON_2);

    return ESP_OK;
}

system_button_action_t system_button_manager_poll(resq_state_t current_state)
{
    if (!s_initialized || s_action_queue == NULL) {
        return SYSTEM_BUTTON_ACTION_NONE;
    }

    system_button_action_t selected_action = SYSTEM_BUTTON_ACTION_NONE;
    system_button_action_t candidate = SYSTEM_BUTTON_ACTION_NONE;

    /*
     * Drain the queue each time this function is called.
     * This prevents a stale long-press event from being applied later after
     * the state changes.
     */
    while (xQueueReceive(s_action_queue, &candidate, 0) == pdTRUE) {
        if (candidate == SYSTEM_BUTTON_ACTION_NONE) {
            continue;
        }

        if (!action_allowed_in_state(current_state, candidate)) {
            ESP_LOGW(TAG,
                     "Ignoring button action=%s in state=%s",
                     system_button_action_to_string(candidate),
                     resq_state_to_string(current_state));
            continue;
        }

        /*
         * If multiple actions are queued, keep the first allowed action.
         * Factory reset priority is already naturally handled by button timing.
         */
        if (selected_action == SYSTEM_BUTTON_ACTION_NONE) {
            selected_action = candidate;
        }
    }

    return selected_action;
}
