#include "task_diagnostics.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define TASK_DIAGNOSTICS_MAX_TASKS 16
#define TASK_DIAGNOSTICS_NAME_LEN 32
#define TASK_DIAGNOSTICS_LOG_INTERVAL_US (60LL * 1000LL * 1000LL)

typedef struct {
    bool used;
    char name[TASK_DIAGNOSTICS_NAME_LEN];
    UBaseType_t minimum_free_words;
    size_t minimum_free_bytes;
    int64_t last_low_stack_log_us;
} task_diagnostics_entry_t;

static const char *TAG = "task_diagnostics";
static SemaphoreHandle_t s_mutex;
static portMUX_TYPE s_init_lock = portMUX_INITIALIZER_UNLOCKED;
static task_diagnostics_entry_t s_entries[TASK_DIAGNOSTICS_MAX_TASKS];

static esp_err_t ensure_initialized(void)
{
    if (s_mutex != NULL) {
        return ESP_OK;
    }

    SemaphoreHandle_t mutex = xSemaphoreCreateMutex();
    if (mutex == NULL) {
        return ESP_ERR_NO_MEM;
    }

    portENTER_CRITICAL(&s_init_lock);
    if (s_mutex == NULL) {
        s_mutex = mutex;
        mutex = NULL;
    }
    portEXIT_CRITICAL(&s_init_lock);

    if (mutex != NULL) {
        vSemaphoreDelete(mutex);
    }
    return ESP_OK;
}

static task_diagnostics_entry_t *find_entry(const char *task_name)
{
    for (size_t i = 0; i < TASK_DIAGNOSTICS_MAX_TASKS; ++i) {
        if (s_entries[i].used &&
            strcmp(s_entries[i].name, task_name) == 0) {
            return &s_entries[i];
        }
    }
    return NULL;
}

static task_diagnostics_entry_t *find_or_allocate_entry(
    const char *task_name)
{
    task_diagnostics_entry_t *entry = find_entry(task_name);
    if (entry != NULL) {
        return entry;
    }
    for (size_t i = 0; i < TASK_DIAGNOSTICS_MAX_TASKS; ++i) {
        if (!s_entries[i].used) {
            s_entries[i].used = true;
            snprintf(s_entries[i].name, sizeof(s_entries[i].name), "%s",
                     task_name);
            s_entries[i].minimum_free_words = UINT32_MAX;
            s_entries[i].minimum_free_bytes = SIZE_MAX;
            return &s_entries[i];
        }
    }
    return NULL;
}

void task_diagnostics_record_stack_watermark(const char *task_name)
{
    if (ensure_initialized() != ESP_OK) {
        return;
    }
    if (task_name == NULL || task_name[0] == '\0') {
        task_name = pcTaskGetName(NULL);
    }

    UBaseType_t words = uxTaskGetStackHighWaterMark(NULL);
    size_t bytes = (size_t)words * sizeof(StackType_t);
    bool log_warning = false;
    bool log_critical = false;
    int64_t now_us = esp_timer_get_time();

    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) {
        return;
    }
    task_diagnostics_entry_t *entry = find_or_allocate_entry(task_name);
    if (entry != NULL) {
        if (words < entry->minimum_free_words) {
            entry->minimum_free_words = words;
            entry->minimum_free_bytes = bytes;
        }
        if (bytes < TASK_STACK_WARNING_BYTES &&
            (entry->last_low_stack_log_us == 0 ||
             now_us - entry->last_low_stack_log_us >=
                 TASK_DIAGNOSTICS_LOG_INTERVAL_US)) {
            entry->last_low_stack_log_us = now_us;
            log_critical = bytes < TASK_STACK_CRITICAL_BYTES;
            log_warning = !log_critical;
        }
    }
    xSemaphoreGive(s_mutex);

    if (log_critical) {
        ESP_LOGE(TAG, "Critical low stack task=%s free=%u bytes",
                 task_name, (unsigned)bytes);
    } else if (log_warning) {
        ESP_LOGW(TAG, "Low stack task=%s free=%u bytes",
                 task_name, (unsigned)bytes);
    }
}

esp_err_t task_diagnostics_get_stack_watermark(
    const char *task_name,
    task_stack_watermark_t *out)
{
    if (task_name == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t err = ensure_initialized();
    if (err != ESP_OK) {
        return err;
    }
    if (xSemaphoreTake(s_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    task_diagnostics_entry_t *entry = find_entry(task_name);
    if (entry == NULL) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NOT_FOUND;
    }
    out->task_name = entry->name;
    out->minimum_free_words = entry->minimum_free_words;
    out->minimum_free_bytes = entry->minimum_free_bytes;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t task_diagnostics_get_memory_snapshot(
    firmware_memory_snapshot_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    out->free_heap_bytes = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    out->minimum_free_heap_bytes =
        heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT);
    out->largest_free_block_bytes =
        heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    return ESP_OK;
}
