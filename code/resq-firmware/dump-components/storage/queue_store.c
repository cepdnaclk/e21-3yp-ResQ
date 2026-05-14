#include "queue_store.h"

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static queue_item_t s_items[QUEUE_STORE_CAPACITY];
static size_t s_head = 0;
static size_t s_tail = 0;
static size_t s_count = 0;
static SemaphoreHandle_t s_mutex = NULL;

esp_err_t queue_store_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    s_head = 0;
    s_tail = 0;
    s_count = 0;
    return ESP_OK;
}

esp_err_t queue_store_push(const queue_item_t *item)
{
    if (item == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_count >= QUEUE_STORE_CAPACITY) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NO_MEM;
    }

    s_items[s_tail] = *item;
    s_tail = (s_tail + 1) % QUEUE_STORE_CAPACITY;
    s_count++;

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t queue_store_push_overwrite_oldest(const queue_item_t *item)
{
    if (item == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_count >= QUEUE_STORE_CAPACITY) {
        s_head = (s_head + 1) % QUEUE_STORE_CAPACITY;
        s_count--;
    }

    s_items[s_tail] = *item;
    s_tail = (s_tail + 1) % QUEUE_STORE_CAPACITY;
    s_count++;

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t queue_store_peek(queue_item_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_count == 0) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NOT_FOUND;
    }

    *out = s_items[s_head];
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t queue_store_pop(void)
{
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_count == 0) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_NOT_FOUND;
    }

    s_head = (s_head + 1) % QUEUE_STORE_CAPACITY;
    s_count--;

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

bool queue_store_is_empty(void)
{
    bool empty = true;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) == pdTRUE) {
        empty = (s_count == 0);
        xSemaphoreGive(s_mutex);
    }

    return empty;
}

size_t queue_store_count(void)
{
    size_t count = 0;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(20)) == pdTRUE) {
        count = s_count;
        xSemaphoreGive(s_mutex);
    }

    return count;
}