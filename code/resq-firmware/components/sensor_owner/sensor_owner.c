#include "sensor_owner.h"

#include "freertos/semphr.h"
#include "freertos/task.h"

static SemaphoreHandle_t s_mutex;
static StaticSemaphore_t s_mutex_storage;
static portMUX_TYPE s_init_lock = portMUX_INITIALIZER_UNLOCKED;
static sensor_owner_t s_owner = SENSOR_OWNER_NONE;

esp_err_t sensor_owner_init(void)
{
    portENTER_CRITICAL(&s_init_lock);
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutexStatic(&s_mutex_storage);
    }
    SemaphoreHandle_t mutex = s_mutex;
    portEXIT_CRITICAL(&s_init_lock);

    return mutex != NULL ? ESP_OK : ESP_ERR_NO_MEM;
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

    esp_err_t result = ESP_ERR_INVALID_STATE;
    if (s_owner == owner) {
        s_owner = SENSOR_OWNER_NONE;
        result = ESP_OK;
    }

    xSemaphoreGive(s_mutex);
    return result;
}

esp_err_t sensor_owner_get(sensor_owner_t *out_owner)
{
    if (out_owner == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    *out_owner = s_owner;
    xSemaphoreGive(s_mutex);
    return ESP_OK;
}

esp_err_t sensor_owner_is(sensor_owner_t owner, bool *out_is_owner)
{
    if (out_is_owner == NULL || owner == SENSOR_OWNER_NONE) {
        return ESP_ERR_INVALID_ARG;
    }

    sensor_owner_t current_owner;
    esp_err_t err = sensor_owner_get(&current_owner);
    if (err != ESP_OK) {
        return err;
    }

    *out_is_owner = current_owner == owner;
    return ESP_OK;
}

esp_err_t sensor_owner_wait_until_free(TickType_t timeout)
{
    TickType_t start = xTaskGetTickCount();
    do {
        sensor_owner_t owner;
        esp_err_t err = sensor_owner_get(&owner);
        if (err != ESP_OK) {
            return err;
        }
        if (owner == SENSOR_OWNER_NONE) {
            return ESP_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    } while ((xTaskGetTickCount() - start) < timeout);

    sensor_owner_t owner;
    esp_err_t err = sensor_owner_get(&owner);
    if (err != ESP_OK) {
        return err;
    }
    return owner == SENSOR_OWNER_NONE ? ESP_OK : ESP_ERR_TIMEOUT;
}

void sensor_owner_reset_for_test(void)
{
    if (sensor_owner_init() != ESP_OK) {
        return;
    }
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) == pdTRUE) {
        s_owner = SENSOR_OWNER_NONE;
        xSemaphoreGive(s_mutex);
    }
}
