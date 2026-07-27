#include "status_indicator.h"

#include <stdbool.h>
#include <stdatomic.h>

#include "board_config.h"
#include "buzzer_manager.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

/* Blink intervals for LED patterns (in RTOS ticks). */
#define LED_BLINK_SLOW_TICKS      pdMS_TO_TICKS(1500)
#define LED_BLINK_MEDIUM_TICKS    pdMS_TO_TICKS(700)
#define LED_BLINK_FAST_TICKS      pdMS_TO_TICKS(150)

/* Task stack size and priority for the status indicator task. */
#define STATUS_TASK_STACK_SIZE    2048
#define STATUS_TASK_PRIORITY      1

/* LED pattern types used by the state and activity LEDs.
 * OFF/ON are static levels; BLINK_* toggles the LED at the given pace.
 */
typedef enum
{
    LED_PATTERN_OFF = 0,
    LED_PATTERN_ON,
    LED_PATTERN_BLINK_SLOW,
    LED_PATTERN_BLINK_MEDIUM,
    LED_PATTERN_BLINK_FAST
} led_pattern_t;

/* Pattern pair for a device state: `state_led` and `activity_led`. */
typedef struct
{
    led_pattern_t state_led;
    led_pattern_t activity_led;
} status_led_pattern_t;

static const char *TAG = "status_indicator";

/* FreeRTOS task handle for the status indicator task. */
static TaskHandle_t s_status_task_handle = NULL;
static EventGroupHandle_t s_status_events = NULL;
static StaticSemaphore_t s_status_lifecycle_mutex_storage;
static SemaphoreHandle_t s_status_lifecycle_mutex;

static _Atomic resq_state_t s_current_state = RESQ_STATE_BOOT;

#define STATUS_TASK_STOP_REQUESTED_BIT BIT0
#define STATUS_TASK_STARTED_BIT BIT1
#define STATUS_TASK_STOPPED_BIT BIT2

/* Provisioning-owned temporary override. Accessed atomically across tasks. */
static bool s_both_leds_on_override = false;

/* Convert a blink pattern to a FreeRTOS tick delay used by vTaskDelay.
 * For non-blinking patterns a default short delay is returned so the task
 * loop still yields occasionally.
 */
static TickType_t get_pattern_delay(led_pattern_t pattern)
{
    switch (pattern)
    {
    case LED_PATTERN_BLINK_SLOW:
        return LED_BLINK_SLOW_TICKS;

    case LED_PATTERN_BLINK_MEDIUM:
        return LED_BLINK_MEDIUM_TICKS;

    case LED_PATTERN_BLINK_FAST:
        return LED_BLINK_FAST_TICKS;

    default:
        return pdMS_TO_TICKS(250);
    }
}

/* Map a high-level `resq_state_t` to the desired LED patterns.
 * Returns a `status_led_pattern_t` containing the pattern for `state_led`
 * and `activity_led`.
 */
static status_led_pattern_t get_state_pattern(resq_state_t state)
{
    switch (state)
    {
    case RESQ_STATE_BOOT:
        return (status_led_pattern_t){LED_PATTERN_BLINK_SLOW, LED_PATTERN_OFF};

    case RESQ_STATE_CONFIG_CHECK:
        return (status_led_pattern_t){LED_PATTERN_BLINK_SLOW, LED_PATTERN_BLINK_FAST};

    case RESQ_STATE_PROVISIONING:
        return (status_led_pattern_t){LED_PATTERN_BLINK_MEDIUM, LED_PATTERN_BLINK_MEDIUM};

    case RESQ_STATE_FLUSH_CONFIG:
        return (status_led_pattern_t){LED_PATTERN_OFF, LED_PATTERN_BLINK_FAST};

    case RESQ_STATE_WIFI_CONNECTING:
        return (status_led_pattern_t){LED_PATTERN_BLINK_SLOW, LED_PATTERN_BLINK_SLOW};

    case RESQ_STATE_BACKEND_REGISTERING:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_BLINK_SLOW};

    case RESQ_STATE_MQTT_CONNECTING:
        return (status_led_pattern_t){LED_PATTERN_BLINK_SLOW, LED_PATTERN_ON};

    case RESQ_STATE_PAIRED_IDLE:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_OFF};

    case RESQ_STATE_CALIBRATING:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_BLINK_MEDIUM};

    case RESQ_STATE_CALIBRATION_FAIL:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_BLINK_FAST};

    case RESQ_STATE_READY_FOR_SESSION:
        return (status_led_pattern_t){LED_PATTERN_OFF, LED_PATTERN_ON};

    case RESQ_STATE_SESSION_ACTIVE:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_ON};

    case RESQ_STATE_SESSION_INTERRUPTED:
        return (status_led_pattern_t){LED_PATTERN_ON, LED_PATTERN_BLINK_FAST};

    case RESQ_STATE_ERROR:
        return (status_led_pattern_t){LED_PATTERN_BLINK_FAST, LED_PATTERN_BLINK_FAST};

    case RESQ_STATE_RESETTING:
        return (status_led_pattern_t){LED_PATTERN_BLINK_FAST, LED_PATTERN_OFF};

    case RESQ_STATE_TURN_OFF:
        return (status_led_pattern_t){LED_PATTERN_BLINK_SLOW, LED_PATTERN_BLINK_SLOW};

    default:
        return (status_led_pattern_t){LED_PATTERN_BLINK_FAST, LED_PATTERN_BLINK_FAST};
    }
}

/* Apply a static (non-blinking) pattern to the specified GPIO.
 * Sets the GPIO level high for LED_PATTERN_ON and low for LED_PATTERN_OFF.
 */
static void apply_static_pattern(gpio_num_t gpio, led_pattern_t pattern)
{
    if (pattern == LED_PATTERN_ON)
    {
        gpio_set_level(gpio, 1);
    }
    else if (pattern == LED_PATTERN_OFF)
    {
        gpio_set_level(gpio, 0);
    }
}

/* Check whether a pattern represents a blinking behavior. */
static bool is_blink_pattern(led_pattern_t pattern)
{
    return pattern == LED_PATTERN_BLINK_SLOW ||
           pattern == LED_PATTERN_BLINK_MEDIUM ||
           pattern == LED_PATTERN_BLINK_FAST;
}

/* FreeRTOS task that controls the state and activity LEDs (and buzzer).
 *
 * Behavior:
 * - Reads the current `s_current_state` and computes the two LED patterns.
 * - Applies static levels for ON/OFF patterns and toggles `blink_level` for
 *   blink patterns.
 * - Sleeps for the shortest active blink interval so a faster LED keeps its
 *   timing when paired with a slower one.
 * - When `s_task_running` becomes false the task turns hardware off, clears
 *   its handle and deletes itself.
 */
static void status_indicator_task(void *arg)
{
    bool blink_level = false;
    xEventGroupSetBits(s_status_events, STATUS_TASK_STARTED_BIT);

    while ((xEventGroupGetBits(s_status_events) &
            STATUS_TASK_STOP_REQUESTED_BIT) == 0)
    {
        if (__atomic_load_n(&s_both_leds_on_override, __ATOMIC_ACQUIRE))
        {
            gpio_set_level(BOARD_STATE_LED, 1);
            gpio_set_level(BOARD_ACTIVITY_LED, 1);
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }

        status_led_pattern_t pattern = get_state_pattern(
            atomic_load_explicit(&s_current_state, memory_order_acquire));

        apply_static_pattern(BOARD_STATE_LED, pattern.state_led);
        apply_static_pattern(BOARD_ACTIVITY_LED, pattern.activity_led);

        if (is_blink_pattern(pattern.state_led))
        {
            gpio_set_level(BOARD_STATE_LED, blink_level);
        }

        if (is_blink_pattern(pattern.activity_led))
        {
            gpio_set_level(BOARD_ACTIVITY_LED, blink_level);
        }

        TickType_t delay_ticks = pdMS_TO_TICKS(250);

        if (is_blink_pattern(pattern.state_led))
        {
            delay_ticks = get_pattern_delay(pattern.state_led);
        }

        if (is_blink_pattern(pattern.activity_led))
        {
            TickType_t activity_delay = get_pattern_delay(pattern.activity_led);
            if (activity_delay < delay_ticks)
            {
                delay_ticks = activity_delay;
            }
        }

        blink_level = !blink_level;
        ulTaskNotifyTake(pdTRUE, delay_ticks);
    }

    gpio_set_level(BOARD_STATE_LED, 0);
    gpio_set_level(BOARD_ACTIVITY_LED, 0);
    __atomic_store_n(&s_both_leds_on_override, false, __ATOMIC_RELEASE);
    xSemaphoreTake(s_status_lifecycle_mutex, portMAX_DELAY);
    s_status_task_handle = NULL;
    xSemaphoreGive(s_status_lifecycle_mutex);
    xEventGroupSetBits(s_status_events, STATUS_TASK_STOPPED_BIT);
    vTaskDelete(NULL);
}

/* Configure GPIOs for the state and activity LEDs.
 * Leaves outputs in the OFF state and sets the initial state to
 * `RESQ_STATE_BOOT`.
 */
esp_err_t status_indicator_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOARD_STATE_LED) |
                        (1ULL << BOARD_ACTIVITY_LED),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK)
    {
        ESP_LOGE(TAG, "Failed to configure status indicator GPIOs");
        return err;
    }

    gpio_set_level(BOARD_STATE_LED, 0);
    gpio_set_level(BOARD_ACTIVITY_LED, 0);
    atomic_store_explicit(&s_current_state, RESQ_STATE_BOOT,
                          memory_order_release);
    __atomic_store_n(&s_both_leds_on_override, false, __ATOMIC_RELEASE);
    if (s_status_lifecycle_mutex == NULL) {
        s_status_lifecycle_mutex = xSemaphoreCreateMutexStatic(
            &s_status_lifecycle_mutex_storage);
        if (s_status_lifecycle_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    return ESP_OK;
}

/* Create and start the status indicator FreeRTOS task if needed. */
esp_err_t status_indicator_start(void)
{
    if (s_status_events == NULL) {
        s_status_events = xEventGroupCreate();
        if (s_status_events == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    xEventGroupClearBits(s_status_events, STATUS_TASK_STOP_REQUESTED_BIT |
                                             STATUS_TASK_STARTED_BIT |
                                             STATUS_TASK_STOPPED_BIT);
    xSemaphoreTake(s_status_lifecycle_mutex, portMAX_DELAY);
    if (s_status_task_handle != NULL)
    {
        xSemaphoreGive(s_status_lifecycle_mutex);
        return ESP_OK;
    }

    BaseType_t result = xTaskCreate(
        status_indicator_task,
        "status_indicator",
        STATUS_TASK_STACK_SIZE,
        NULL,
        STATUS_TASK_PRIORITY,
        &s_status_task_handle);
    xSemaphoreGive(s_status_lifecycle_mutex);

    if (result != pdPASS)
    {
        return ESP_FAIL;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_status_events, STATUS_TASK_STARTED_BIT | STATUS_TASK_STOPPED_BIT,
        pdFALSE, pdFALSE, pdMS_TO_TICKS(1000));
    return (bits & STATUS_TASK_STARTED_BIT) != 0 ? ESP_OK : ESP_ERR_TIMEOUT;
}

/* Signal the background task to stop. The task will cleanup and delete
 * itself; this function returns immediately.
 */
void status_indicator_stop(void)
{
    __atomic_store_n(&s_both_leds_on_override, false, __ATOMIC_RELEASE);
    if (s_status_events == NULL) {
        return;
    }
    xSemaphoreTake(s_status_lifecycle_mutex, portMAX_DELAY);
    TaskHandle_t task = s_status_task_handle;
    xSemaphoreGive(s_status_lifecycle_mutex);
    if (task == NULL) {
        return;
    }
    xEventGroupSetBits(s_status_events, STATUS_TASK_STOP_REQUESTED_BIT);
    xTaskNotifyGive(task);
    (void)xEventGroupWaitBits(s_status_events, STATUS_TASK_STOPPED_BIT,
                              pdFALSE, pdFALSE, pdMS_TO_TICKS(1000));
}

/* Update the current state shown by the LEDs. This is non-blocking and
 * can be called from other tasks.
 */
void status_indicator_set_state(resq_state_t state)
{
    if (state != RESQ_STATE_PROVISIONING) {
        __atomic_store_n(&s_both_leds_on_override, false, __ATOMIC_RELEASE);
    }
    atomic_store_explicit(&s_current_state, state, memory_order_release);
    ESP_LOGI(TAG, "State indicator changed to %s", resq_state_to_string(state));
}

/* Return the currently configured `resq_state_t`. */
resq_state_t status_indicator_get_state(void)
{
    return atomic_load_explicit(&s_current_state, memory_order_acquire);
}

void status_indicator_set_both_leds_on(bool enabled)
{
    __atomic_store_n(&s_both_leds_on_override, enabled, __ATOMIC_RELEASE);
    if (enabled) {
        gpio_set_level(BOARD_STATE_LED, 1);
        gpio_set_level(BOARD_ACTIVITY_LED, 1);
    }
    ESP_LOGI(TAG, "Both-LED provisioning override %s",
             enabled ? "enabled" : "cleared");
}

bool status_indicator_are_both_leds_overridden_on(void)
{
    return __atomic_load_n(&s_both_leds_on_override, __ATOMIC_ACQUIRE);
}

/* Produce a single short beep on the buzzer (blocking for ~100ms). */
void status_indicator_beep_once(void)
{
    esp_err_t err = buzzer_manager_beep_once(100);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "Buzzer pulse failed: %s", esp_err_to_name(err));
    }
}
