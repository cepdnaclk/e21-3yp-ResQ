#include "sensor_owner.h"

#include "freertos/semphr.h"
#include "freertos/task.h"

static SemaphoreHandle_t s_mutex;
static sensor_owner_t s_owner = SENSOR_OWNER_NONE;

esp_err_t sensor_owner_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    s_owner = SENSOR_OWNER_NONE;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t sensor_owner_acquire(sensor_owner_t owner)
{
    if (owner == SENSOR_OWNER_NONE) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t result = ESP_OK;
    if (s_owner == SENSOR_OWNER_NONE) {
        s_owner = owner;
    } else if (s_owner == owner) {
        result = ESP_ERR_INVALID_STATE;
    } else {
        result = ESP_ERR_INVALID_STATE;
    }

    xSemaphoreGive(s_mutex);
    return result;
}

esp_err_t sensor_owner_release(sensor_owner_t owner)
{
    if (owner == SENSOR_OWNER_NONE) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_owner == owner) {
        s_owner = SENSOR_OWNER_NONE;
    }

    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

sensor_owner_t sensor_owner_get(void)
{
    sensor_owner_t owner = SENSOR_OWNER_NONE;
    if (s_mutex == NULL) {
        return SENSOR_OWNER_NONE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        return SENSOR_OWNER_NONE;
    }
    owner = s_owner;
    xSemaphoreGive(s_mutex);
    return owner;
}

bool sensor_owner_is(sensor_owner_t owner)
{
    return sensor_owner_get() == owner;
}

esp_err_t sensor_owner_wait_until_free(TickType_t timeout)
{
    TickType_t start = xTaskGetTickCount();
    do {
        if (sensor_owner_get() == SENSOR_OWNER_NONE) {
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    } while ((xTaskGetTickCount() - start) < timeout);

    return sensor_owner_get() == SENSOR_OWNER_NONE ? ESP_OK : ESP_ERR_TIMEOUT;
}

void sensor_owner_reset_for_test(void)
{
    if (sensor_owner_init() != ESP_OK) {
        return;
    }
}
