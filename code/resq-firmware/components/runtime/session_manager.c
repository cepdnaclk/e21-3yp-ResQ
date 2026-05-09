#include "session_manager.h"

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include <stdio.h>
#include <string.h>

static const char *TAG = "session_manager";

static bool s_active = false;
static char s_session_id[64] = {0};
static SemaphoreHandle_t s_mutex = NULL;

static bool lock_session_state(TickType_t timeout)
{
    if (s_mutex == NULL) {
        return false;
    }

    return xSemaphoreTake(s_mutex, timeout) == pdTRUE;
}

static void unlock_session_state(void)
{
    xSemaphoreGive(s_mutex);
}

void session_manager_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            ESP_LOGE(TAG, "failed to create session mutex");
            return;
        }
    }

    if (!lock_session_state(portMAX_DELAY)) {
        return;
    }

    s_active = false;
    s_session_id[0] = '\0';

    unlock_session_state();
}

void session_manager_start(const char *session_id)
{
    if (!lock_session_state(portMAX_DELAY)) {
        return;
    }

    s_active = true;

    if (session_id != NULL) {
        snprintf(s_session_id, sizeof(s_session_id), "%s", session_id);
    } else {
        s_session_id[0] = '\0';
    }

    unlock_session_state();
}

void session_manager_stop(void)
{
    if (!lock_session_state(portMAX_DELAY)) {
        return;
    }

    s_active = false;
    s_session_id[0] = '\0';

    unlock_session_state();
}

bool session_manager_is_active(void)
{
    bool active = false;

    if (lock_session_state(pdMS_TO_TICKS(20))) {
        active = s_active;
        unlock_session_state();
    }

    return active;
}

bool session_manager_get_session_id(char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return false;
    }

    out[0] = '\0';
    bool has_session_id = false;

    if (lock_session_state(pdMS_TO_TICKS(20))) {
        snprintf(out, out_len, "%s", s_session_id);
        has_session_id = s_session_id[0] != '\0';
        unlock_session_state();
    }

    return has_session_id;
}
