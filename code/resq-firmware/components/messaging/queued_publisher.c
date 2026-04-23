#include "queued_publisher.h"

#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "mqtt_manager.h"
#include "queue_store.h"

#define QUEUE_FLUSH_PERIOD_MS 1000
#define QUEUE_TASK_STACK_SIZE 4096
#define QUEUE_TASK_PRIORITY      3

static const char *TAG = "queued_pub";

static TaskHandle_t s_task_handle = NULL;

static void queue_flush_task(void *arg)
{
    (void)arg;

    while (1) {
        if (mqtt_manager_is_connected() && !queue_store_is_empty()) {
            queue_item_t item;
            if (queue_store_peek(&item) == ESP_OK) {
                esp_err_t err = mqtt_manager_publish(
                    item.topic_suffix,
                    item.payload,
                    item.qos,
                    item.retain
                );

                if (err == ESP_OK) {
                    queue_store_pop();
                    ESP_LOGI(TAG, "Flushed queued packet, remaining=%u", (unsigned)queue_store_count());
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(QUEUE_FLUSH_PERIOD_MS));
    }
}

esp_err_t queued_publisher_init(void)
{
    return queue_store_init();
}

esp_err_t queued_publisher_start(void)
{
    if (s_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t ok = xTaskCreate(
        queue_flush_task,
        "queue_flush_task",
        QUEUE_TASK_STACK_SIZE,
        NULL,
        QUEUE_TASK_PRIORITY,
        &s_task_handle
    );

    return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}

esp_err_t queued_publisher_publish_or_queue(
    const char *suffix,
    const char *payload,
    int qos,
    int retain
)
{
    if (suffix == NULL || payload == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (mqtt_manager_is_connected()) {
        esp_err_t err = mqtt_manager_publish(suffix, payload, qos, retain);
        if (err == ESP_OK) {
            return ESP_OK;
        }
    }

    queue_item_t item = {0};
    snprintf(item.topic_suffix, sizeof(item.topic_suffix), "%s", suffix);
    snprintf(item.payload, sizeof(item.payload), "%s", payload);
    item.qos = qos;
    item.retain = retain;

    ESP_LOGW(TAG, "MQTT unavailable, queueing packet for %s", suffix);
    return queue_store_push(&item);
}