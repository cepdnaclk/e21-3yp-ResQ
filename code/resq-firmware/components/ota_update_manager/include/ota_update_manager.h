#ifndef OTA_UPDATE_MANAGER_H
#define OTA_UPDATE_MANAGER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_http_server.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum
{
    OTA_PHASE_IDLE = 0,
    OTA_PHASE_AUTHENTICATING,
    OTA_PHASE_RECEIVING,
    OTA_PHASE_WRITING,
    OTA_PHASE_VERIFYING,
    OTA_PHASE_SET_BOOT_PARTITION,
    OTA_PHASE_SUCCESS_REBOOTING,
    OTA_PHASE_FAILED
} ota_phase_t;

typedef struct
{
    ota_phase_t phase;
    int32_t progress_pct;
    int32_t bytes_written;
    int32_t total_size;
    int32_t last_error_id;
    char last_result[16];
    char target_version[32];
    char failed_phase[24];
} ota_update_status_t;

esp_err_t ota_update_manager_init(void);

/**
 * @brief Register OTA routes on the provisioning manager's HTTP server.
 */
esp_err_t ota_update_manager_register_http_handlers(httpd_handle_t server);

/**
 * @brief Forget a server that is about to be stopped.
 */
void ota_update_manager_http_server_stopped(httpd_handle_t server);

/**
 * @brief True after an authenticated upload starts and until main consumes
 * the terminal OTA result.
 */
bool ota_update_manager_has_pending_request(void);

/**
 * @brief Run the visible OTA_UPDATE state.
 *
 * Returns OTA_UPDATE while programming, RESETTING after success, and
 * PROVISIONING after failure.
 */
resq_state_t ota_update_manager_run(void);

esp_err_t ota_update_manager_get_status(ota_update_status_t *out_status);

const char *ota_update_manager_phase_to_string(ota_phase_t phase);

#ifdef __cplusplus
}
#endif

#endif /* OTA_UPDATE_MANAGER_H */
