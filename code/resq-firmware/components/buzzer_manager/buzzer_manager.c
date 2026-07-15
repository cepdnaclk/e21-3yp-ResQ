#include "buzzer_manager.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "board_config.h"

static const char *TAG = "buzzer_manager";

static TaskHandle_t s_task = NULL;
static SemaphoreHandle_t s_mutex = NULL;
static EventGroupHandle_t s_task_events = NULL;
static volatile bool s_running = false;
static int s_target_cpm = 110;

#define BUZZER_TASK_STARTED_BIT BIT0
#define BUZZER_TASK_STOPPED_BIT BIT1
#define BUZZER_TASK_START_TIMEOUT_MS 1000
#define BUZZER_TASK_STOP_TIMEOUT_MS 1500

static void buzzer_task(void *arg)
{
    (void)arg;

    int interval_ms = 60000 / s_target_cpm;
    const int pulse_ms = 50;

    xEventGroupSetBits(s_task_events, BUZZER_TASK_STARTED_BIT);

    while (s_running) {
        gpio_set_level(BOARD_BUZZER_GPIO, 1);
        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(pulse_ms)) > 0) {
            break;
        }

        gpio_set_level(BOARD_BUZZER_GPIO, 0);

        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(interval_ms - pulse_ms)) > 0) {
            break;
        }
    }

    gpio_set_level(BOARD_BUZZER_GPIO, 0);

    xSemaphoreTake(s_mutex, portMAX_DELAY);
    s_running = false;
    s_task = NULL;
    xSemaphoreGive(s_mutex);

    xEventGroupSetBits(s_task_events, BUZZER_TASK_STOPPED_BIT);
    vTaskDelete(NULL);
}

esp_err_t buzzer_manager_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) return ESP_ERR_NO_MEM;
    }

    if (s_task_events == NULL) {
        s_task_events = xEventGroupCreate();
        if (s_task_events == NULL) return ESP_ERR_NO_MEM;
    }

    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << BOARD_BUZZER_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };

    gpio_config(&io_conf);
    gpio_set_level(BOARD_BUZZER_GPIO, 0);

    s_running = false;
    s_task = NULL;
    s_target_cpm = 110;
    xEventGroupSetBits(s_task_events, BUZZER_TASK_STOPPED_BIT);

    ESP_LOGI(TAG, "buzzer initialized on gpio %d", BOARD_BUZZER_GPIO);

    return ESP_OK;
}

esp_err_t buzzer_manager_start_metronome(int target_cpm)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task != NULL) {
        esp_err_t result = s_running ? ESP_OK : ESP_ERR_INVALID_STATE;
        xSemaphoreGive(s_mutex);
        return result;
    }

    xEventGroupClearBits(s_task_events,
                         BUZZER_TASK_STARTED_BIT | BUZZER_TASK_STOPPED_BIT);
    s_target_cpm = target_cpm > 0 ? target_cpm : 110;
    s_running = true;

    BaseType_t ok = xTaskCreate(buzzer_task, "buzzer_task", 2048, NULL, 5, &s_task);
    if (ok != pdPASS) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        xEventGroupSetBits(s_task_events, BUZZER_TASK_STOPPED_BIT);
        return ESP_FAIL;
    }

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        BUZZER_TASK_STARTED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(BUZZER_TASK_START_TIMEOUT_MS));

    if ((bits & BUZZER_TASK_STARTED_BIT) == 0) {
        buzzer_manager_stop();
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t buzzer_manager_stop(void)
{
    if (s_mutex == NULL || s_task_events == NULL) return ESP_OK;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    if (s_task == NULL) {
        s_running = false;
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_running = false;
    TaskHandle_t task = s_task;
    xTaskNotifyGive(task);

    xSemaphoreGive(s_mutex);

    EventBits_t bits = xEventGroupWaitBits(
        s_task_events,
        BUZZER_TASK_STOPPED_BIT,
        pdFALSE,
        pdTRUE,
        pdMS_TO_TICKS(BUZZER_TASK_STOP_TIMEOUT_MS));

    if ((bits & BUZZER_TASK_STOPPED_BIT) == 0) {
        gpio_set_level(BOARD_BUZZER_GPIO, 0);
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t buzzer_manager_beep_once(uint32_t duration_ms)
{
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;
    if (duration_ms == 0 || duration_ms > 1000) return ESP_ERR_INVALID_ARG;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    if (s_task != NULL || s_running) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    gpio_set_level(BOARD_BUZZER_GPIO, 1);
    vTaskDelay(pdMS_TO_TICKS(duration_ms));
    gpio_set_level(BOARD_BUZZER_GPIO, 0);
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

bool buzzer_manager_is_running(void)
{
    bool running = false;
    if (s_mutex == NULL) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) return false;
    running = s_running && s_task != NULL;
    xSemaphoreGive(s_mutex);
    return running;
}
