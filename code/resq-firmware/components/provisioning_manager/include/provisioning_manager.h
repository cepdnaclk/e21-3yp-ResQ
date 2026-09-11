#ifndef PROVISIONING_MANAGER_H
#define PROVISIONING_MANAGER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    PROVISIONING_STATE_IDLE = 0,
    PROVISIONING_STATE_RUNNING,
    PROVISIONING_STATE_WAITING_FOR_ACK,
    PROVISIONING_STATE_COMMITTING,
    PROVISIONING_STATE_SAVED,
    PROVISIONING_STATE_STOPPING,
    PROVISIONING_STATE_ERROR,
} provisioning_state_t;

typedef struct {
    provisioning_state_t state;
    bool running;
    bool saved_config_available;
    bool waiting_for_ack;
    uint32_t request_generation;
    esp_err_t last_error;
} provisioning_status_t;

/**
 * @brief Initialize provisioning manager.
 *
 * This prepares internal variables only.
 * SoftAP and HTTP portal are started separately using provisioning_manager_start().
 */
esp_err_t provisioning_manager_init(void);

/**
 * @brief Start ESP SoftAP and provisioning HTTP portal.
 *
 * The portal receives:
 * - wifi_ssid
 * - wifi_pass
 * - backend_base_url
 *
 * device_mac is NOT accepted from the request.
 * It is always filled from ESP hardware MAC.
 */
esp_err_t provisioning_manager_start(void);

/**
 * @brief Stop provisioning HTTP portal and SoftAP.
 */
esp_err_t provisioning_manager_stop(void);

/**
 * @brief Check whether provisioning portal is currently running.
 */
bool provisioning_manager_is_running(void);

/**
 * @brief Check whether valid network config was received and saved.
 */
bool provisioning_manager_has_saved_config(void);

/**
 * @brief Copy the latest saved network config from provisioning manager.
 */
esp_err_t provisioning_manager_get_network_config(network_config_t *out_config);

/**
 * @brief Atomically copy and consume the saved-config notification.
 *
 * The latest saved values remain available through
 * provisioning_manager_get_network_config().
 */
esp_err_t provisioning_manager_take_saved_config(network_config_t *out_config,
                                                 bool *out_available);

/**
 * @brief Copy a coherent provisioning status snapshot.
 */
esp_err_t provisioning_manager_get_status(provisioning_status_t *out_status);

/**
 * @brief Parse a JSON or form-urlencoded provisioning payload transactionally.
 *
 * Empty Wi-Fi passwords are valid. On failure, @p out_config is unchanged.
 */
esp_err_t provisioning_manager_parse_payload(const char *body,
                                             network_config_t *out_config);

/**
 * @brief Return the embedded provisioning page.
 */
const char *provisioning_manager_get_page_html(void);

#if CONFIG_UNITY_ENABLE_IDF_TEST_RUNNER
esp_err_t provisioning_manager_test_reset(void);
void provisioning_manager_test_set_save_result(esp_err_t result);
esp_err_t provisioning_manager_test_submit(const network_config_t *candidate,
                                           char *out_ack_id,
                                           size_t out_ack_id_len);
esp_err_t provisioning_manager_test_commit_ack(const char *ack_id);
esp_err_t provisioning_manager_test_set_stopping(void);
#endif

#ifdef __cplusplus
}
#endif

#endif /* PROVISIONING_MANAGER_H */
