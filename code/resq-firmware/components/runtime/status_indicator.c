#include "status_indicator.h"

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define STATUS_LED_GPIO GPIO_NUM_8
#define BUZZER_GPIO     GPIO_NUM_10

#define INDICATOR_TASK_STACK_SIZE 2048
#define INDICATOR_TASK_PRIORITY      2

static indicator_state_t s_state = INDICATOR_STATE_OFF;
static TaskHandle_t s_task_handle = NULL;

static void led_on(void)
{
    gpio_set_level(STATUS_LED_GPIO, 1);
}

static void led_off(void)
{
    gpio_set_level(STATUS_LED_GPIO, 0);
}

static void buzzer_on(void)
{
    gpio_set_level(BUZZER_GPIO, 1);
}

static void buzzer_off(void)
{
    gpio_set_level(BUZZER_GPIO, 0);
}

static void indicator_task(void *arg)
{
    (void)arg;

    while (1) {
        switch (s_state) {
            case INDICATOR_STATE_OFF:
                led_off();
                buzzer_off();
                vTaskDelay(pdMS_TO_TICKS(300));
                break;

            case INDICATOR_STATE_PROVISIONING:
                led_on();
                vTaskDelay(pdMS_TO_TICKS(500));
                led_off();
                vTaskDelay(pdMS_TO_TICKS(500));
                break;

            case INDICATOR_STATE_WIFI_CONNECTING:
                led_on();
                vTaskDelay(pdMS_TO_TICKS(150));
                led_off();
                vTaskDelay(pdMS_TO_TICKS(150));
                break;

            case INDICATOR_STATE_ONLINE_IDLE:
                led_on();
                buzzer_off();
                vTaskDelay(pdMS_TO_TICKS(300));
                break;

            case INDICATOR_STATE_SESSION_ACTIVE:
                led_on();
                vTaskDelay(pdMS_TO_TICKS(250));
                led_off();
                vTaskDelay(pdMS_TO_TICKS(250));
                break;

            case INDICATOR_STATE_FAULT:
                led_on();
                buzzer_on();
                vTaskDelay(pdMS_TO_TICKS(100));
                led_off();
                buzzer_off();
                vTaskDelay(pdMS_TO_TICKS(100));
                led_on();
                buzzer_on();
                vTaskDelay(pdMS_TO_TICKS(100));
                led_off();
                buzzer_off();
                vTaskDelay(pdMS_TO_TICKS(600));
                break;

            case INDICATOR_STATE_RESETTING:
                led_on();
                vTaskDelay(pdMS_TO_TICKS(70));
                led_off();
                vTaskDelay(pdMS_TO_TICKS(70));
                break;

            default:
                led_off();
                buzzer_off();
                vTaskDelay(pdMS_TO_TICKS(300));
                break;
        }
    }
}

esp_err_t status_indicator_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << STATUS_LED_GPIO) | (1ULL << BUZZER_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };

    esp_err_t err = gpio_config(&io_conf);
    if (err != ESP_OK) {
        return err;
    }

    led_off();
    buzzer_off();
    s_state = INDICATOR_STATE_OFF;

    return ESP_OK;
}

esp_err_t status_indicator_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        indicator_task,
        "indicator_task",
        INDICATOR_TASK_STACK_SIZE,
        NULL,
        INDICATOR_TASK_PRIORITY,
        &s_task_handle
    );

    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}

void status_indicator_set(indicator_state_t state)
{
    s_state = state;
}