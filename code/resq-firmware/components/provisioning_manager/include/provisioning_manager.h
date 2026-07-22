#ifndef PROVISIONING_MANAGER_H
#define PROVISIONING_MANAGER_H

#include <stdbool.h>

#include "esp_err.h"
#include "resq_config_types.h"

#ifdef __cplusplus
extern "C" {
#endif

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

#ifdef __cplusplus
}
#endif

#endif /* PROVISIONING_MANAGER_H */
