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
#define SYSTEM_BUTTON_RELEASED_LEVEL        1
#define SYSTEM_BUTTON_DEBOUNCE_MS           50
#define SYSTEM_BUTTON_LONG_PRESS_MS         3000
#define SYSTEM_BUTTON_TASK_POLL_MS          20
#define SYSTEM_BUTTON_EDGE_QUEUE_LEN        16
#define SYSTEM_BUTTON_EVENT_QUEUE_LEN       8
#define SYSTEM_BUTTON_TASK_STACK_WORDS      3072
#define SYSTEM_BUTTON_TASK_PRIORITY         10

typedef struct {
    gpio_num_t gpio;
} button_edge_event_t;

typedef struct {
    gpio_num_t gpio;
    system_button_id_t button_id;
    bool pressed;
    TickType_t press_start_tick;
} button_runtime_t;

static bool s_initialized = false;
static QueueHandle_t s_edge_queue = NULL;
static QueueHandle_t s_event_queue = NULL;
static TaskHandle_t s_button_task_handle = NULL;

static button_runtime_t s_button_1 = {
    .gpio = BUTTON_1,
    .button_id = SYSTEM_BUTTON_ID_1,
    .pressed = false,
    .press_start_tick = 0,
};

static button_runtime_t s_button_2 = {
    .gpio = BUTTON_2,
    .button_id = SYSTEM_BUTTON_ID_2,
    .pressed = false,
    .press_start_tick = 0,
};

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

const char *system_button_id_to_string(system_button_id_t button_id)
{
    switch (button_id) {
    case SYSTEM_BUTTON_ID_1:
        return "BUTTON_1";
    case SYSTEM_BUTTON_ID_2:
        return "BUTTON_2";
    case SYSTEM_BUTTON_ID_NONE:
    default:
        return "NONE";
    }
}

const char *system_button_press_type_to_string(system_button_press_type_t press_type)
{
    switch (press_type) {
    case SYSTEM_BUTTON_PRESS_SHORT:
        return "SHORT";
    case SYSTEM_BUTTON_PRESS_LONG:
        return "LONG";
    case SYSTEM_BUTTON_PRESS_NONE:
    default:
        return "NONE";
    }
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

static void publish_event_for_button(button_runtime_t *button, TickType_t released_tick)
{
    if (button == NULL) {
        return;
    }

    if (button->press_start_tick == 0) {
        return;
    }

    TickType_t now = released_tick;
    uint32_t duration_ms = (uint32_t)((now - button->press_start_tick) * portTICK_PERIOD_MS);

    system_button_press_type_t press_type =
        (duration_ms >= SYSTEM_BUTTON_LONG_PRESS_MS)
            ? SYSTEM_BUTTON_PRESS_LONG
            : SYSTEM_BUTTON_PRESS_SHORT;

    system_button_event_t event = {
        .button_id = button->button_id,
        .press_type = press_type,
        .duration_ms = duration_ms,
        .released_tick = now,
    };

    if (xQueueSend(s_event_queue, &event, 0) != pdTRUE) {
        ESP_LOGW(TAG,
                 "Button event queue full; dropping button=%s press=%s duration=%lu ms",
                 system_button_id_to_string(event.button_id),
                 system_button_press_type_to_string(event.press_type),
                 (unsigned long)event.duration_ms);
    } else {
        ESP_LOGW(TAG,
                 "Button released button=%s press=%s duration=%lu ms",
                 system_button_id_to_string(event.button_id),
                 system_button_press_type_to_string(event.press_type),
                 (unsigned long)event.duration_ms);
    }

    button->press_start_tick = 0;
}

static void update_button_state_from_edge(gpio_num_t gpio)
{
    button_runtime_t *button = button_runtime_for_gpio(gpio);
    if (button == NULL) {
        return;
    }

    vTaskDelay(pdMS_TO_TICKS(SYSTEM_BUTTON_DEBOUNCE_MS));

    int stable_level = gpio_get_level(gpio);
    bool now_pressed = (stable_level == SYSTEM_BUTTON_ACTIVE_LEVEL);
    TickType_t now = xTaskGetTickCount();

    /* Falling edge after debounce: released HIGH -> pressed LOW */
    if (now_pressed && !button->pressed) {
        button->pressed = true;
        button->press_start_tick = now;

        ESP_LOGI(TAG,
                 "Button press started button=%s gpio=%d",
                 system_button_id_to_string(button->button_id),
                 (int)gpio);
        return;
    }

    /* Rising edge after debounce: pressed LOW -> released HIGH */
    if (!now_pressed && button->pressed) {
        publish_event_for_button(button, now);
        button->pressed = false;
        return;
    }
}

static void system_button_task(void *arg)
{
    (void)arg;

    button_edge_event_t edge = {0};

    while (true) {
        if (xQueueReceive(s_edge_queue, &edge, pdMS_TO_TICKS(SYSTEM_BUTTON_TASK_POLL_MS)) == pdTRUE) {
            update_button_state_from_edge(edge.gpio);
        }
    }
}

esp_err_t system_button_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    s_edge_queue = xQueueCreate(SYSTEM_BUTTON_EDGE_QUEUE_LEN, sizeof(button_edge_event_t));
    if (s_edge_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create button edge queue");
        return ESP_ERR_NO_MEM;
    }

    s_event_queue = xQueueCreate(SYSTEM_BUTTON_EVENT_QUEUE_LEN, sizeof(system_button_event_t));
    if (s_event_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create button event queue");
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

esp_err_t system_button_manager_wait_event(system_button_event_t *event, TickType_t timeout_ticks)
{
    if (!s_initialized || s_event_queue == NULL || event == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xQueueReceive(s_event_queue, event, timeout_ticks) == pdTRUE) {
        return ESP_OK;
    }

    return ESP_ERR_TIMEOUT;
}

bool system_button_manager_take_event(system_button_event_t *event)
{
    return system_button_manager_wait_event(event, 0) == ESP_OK;
}

void system_button_manager_drain_events(resq_state_t current_state)
{
    if (!s_initialized || s_event_queue == NULL) {
        return;
    }

    system_button_event_t ev = {0};

    while (xQueueReceive(s_event_queue, &ev, 0) == pdTRUE) {
        ESP_LOGW(TAG,
                 "Drained button event button=%s press=%s duration=%lu ms in state=%s",
                 system_button_id_to_string(ev.button_id),
                 system_button_press_type_to_string(ev.press_type),
                 (unsigned long)ev.duration_ms,
                 resq_state_to_string(current_state));
    }
}

void system_button_manager_drain_actions(resq_state_t current_state)
{
    system_button_manager_drain_events(current_state);
}

system_button_action_t system_button_manager_poll(resq_state_t current_state)
{
    if (!s_initialized || s_event_queue == NULL) {
        return SYSTEM_BUTTON_ACTION_NONE;
    }

    system_button_event_t event = {0};
    system_button_action_t selected_action = SYSTEM_BUTTON_ACTION_NONE;

    while (system_button_manager_take_event(&event)) {
        if (event.press_type != SYSTEM_BUTTON_PRESS_LONG) {
            ESP_LOGI(TAG,
                     "Ignoring short press in global action path button=%s state=%s",
                     system_button_id_to_string(event.button_id),
                     resq_state_to_string(current_state));
            continue;
        }

        system_button_action_t action = SYSTEM_BUTTON_ACTION_NONE;

        if (event.button_id == SYSTEM_BUTTON_ID_1) {
            action = SYSTEM_BUTTON_ACTION_TURN_OFF;
        } else if (event.button_id == SYSTEM_BUTTON_ID_2) {
            action = SYSTEM_BUTTON_ACTION_FACTORY_RESET;
        }

        if (!action_allowed_in_state(current_state, action)) {
            ESP_LOGW(TAG,
                     "Ignoring long press action=%s in state=%s",
                     system_button_action_to_string(action),
                     resq_state_to_string(current_state));
            continue;
        }

        if (selected_action == SYSTEM_BUTTON_ACTION_NONE) {
            selected_action = action;
        }
    }

    return selected_action;
}
