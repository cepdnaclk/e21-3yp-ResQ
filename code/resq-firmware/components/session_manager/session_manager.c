#include "session_manager.h"

#include <string.h>
#include <stdio.h>

#include "esp_timer.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "session_manager";

static session_state_t s_state;
static SemaphoreHandle_t s_mutex = NULL;

esp_err_t session_manager_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    memset(&s_state, 0, sizeof(s_state));

    return ESP_OK;
}

esp_err_t session_manager_start(const char *session_id,
                                const char *profile_id)
{
    if (session_id == NULL || session_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (s_state.active) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    s_state.active = true;
    s_state.interrupted = false;
    s_state.started_at_ms = esp_timer_get_time() / 1000;
    s_state.stopped_at_ms = 0;
    strncpy(s_state.session_id, session_id, sizeof(s_state.session_id) - 1);
    s_state.session_id[sizeof(s_state.session_id) - 1] = '\0';

    if (profile_id) {
        strncpy(s_state.profile_id, profile_id, sizeof(s_state.profile_id) - 1);
        s_state.profile_id[sizeof(s_state.profile_id) - 1] = '\0';
    } else {
        s_state.profile_id[0] = '\0';
    }

    xSemaphoreGive(s_mutex);

    ESP_LOGI(TAG, "Session started id=%s profile=%s", s_state.session_id, s_state.profile_id);

    return ESP_OK;
}

esp_err_t session_manager_stop(const char *session_id)
{
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (!s_state.active) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    if (session_id != NULL && session_id[0] != '\0' && strcmp(session_id, s_state.session_id) != 0) {
        xSemaphoreGive(s_mutex);
        return ESP_ERR_INVALID_ARG;
    }

    s_state.active = false;
    s_state.stopped_at_ms = esp_timer_get_time() / 1000;

    ESP_LOGI(TAG, "Session stopped id=%s", s_state.session_id);

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

esp_err_t session_manager_mark_interrupted(const char *reason)
{
    (void)reason;

    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if (!s_state.active) {
        /* nothing to do */
        xSemaphoreGive(s_mutex);
        return ESP_OK;
    }

    s_state.interrupted = true;
    s_state.active = false;
    s_state.stopped_at_ms = esp_timer_get_time() / 1000;

    ESP_LOGW(TAG, "Session interrupted id=%s reason=%s", s_state.session_id, reason ? reason : "");

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

bool session_manager_is_active(void)
{
    bool ret = false;
    if (s_mutex == NULL) return false;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        return false;
    }
    ret = s_state.active;
    xSemaphoreGive(s_mutex);
    return ret;
}

esp_err_t session_manager_get_state(session_state_t *out_state)
{
    if (out_state == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    memcpy(out_state, &s_state, sizeof(s_state));

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

const char *session_manager_get_session_id(void)
{
    static char empty[] = "";

    if (s_mutex == NULL) return empty;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(50)) != pdTRUE) {
        return empty;
    }

    const char *ret = s_state.active ? s_state.session_id : empty;

    xSemaphoreGive(s_mutex);

    return ret;
}
