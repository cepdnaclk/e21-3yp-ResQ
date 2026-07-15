#ifndef FIRMWARE_STATE_MACHINE_H
#define FIRMWARE_STATE_MACHINE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "backend_register_client.h"
#include "error_codes.h"
#include "esp_err.h"
#include "resq_config_types.h"
#include "session_manager.h"
#include "states.h"
#include "system_button_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    esp_err_t (*initialize_components)(void);

    void (*network_set_defaults)(network_config_t *config);
    void (*calibration_set_defaults)(calibration_config_t *config);
    bool (*network_validate)(network_config_t *config);
    bool (*calibration_validate)(calibration_config_t *config);

    esp_err_t (*load_network)(network_config_t *config);
    esp_err_t (*load_calibration)(calibration_config_t *config);
    esp_err_t (*save_network)(network_config_t *config);
    esp_err_t (*clear_network)(void);
    esp_err_t (*clear_all)(void);

    esp_err_t (*provisioning_start)(void);
    esp_err_t (*provisioning_stop)(void);
    bool (*provisioning_has_saved_config)(void);

    esp_err_t (*wifi_connect)(const char *ssid,
                              const char *password,
                              int max_retries,
                              int timeout_ms);
    esp_err_t (*wifi_disconnect)(void);
    bool (*wifi_is_connected)(void);
    esp_err_t (*wifi_get_ip)(char *buffer, size_t buffer_len);
    int (*wifi_get_rssi)(void);

    esp_err_t (*backend_register)(const network_config_t *config,
                                  backend_registration_result_t *result);

    esp_err_t (*mqtt_start)(const char *device_id,
                            const char *host,
                            int port);
    esp_err_t (*mqtt_stop)(void);
    bool (*mqtt_is_connected)(void);
    esp_err_t (*mqtt_publish_identity)(const network_config_t *network_config);
    esp_err_t (*mqtt_publish_status)(resq_state_t state,
                                     const network_config_t *network_config,
                                     const calibration_config_t *calibration_config,
                                     bool session_active,
                                     const char *session_id,
                                     const char *ip_address);
    esp_err_t (*mqtt_publish_heartbeat)(const network_config_t *network_config,
                                        const calibration_config_t *calibration_config,
                                        resq_state_t state,
                                        bool session_active,
                                        bool sensor_running,
                                        const char *session_id,
                                        const char *ip_address,
                                        int wifi_rssi);
    esp_err_t (*start_heartbeat)(void);
    esp_err_t (*stop_heartbeat)(void);

    resq_state_t (*paired_idle_run)(network_config_t *network_config,
                                    calibration_config_t *calibration_config,
                                    const char *ip_address);
    resq_state_t (*calibration_run)(network_config_t *network_config,
                                    calibration_config_t *calibration_config,
                                    const char *ip_address);
    resq_state_t (*calibration_fail_run)(network_config_t *network_config,
                                         calibration_config_t *calibration_config,
                                         const char *ip_address);
    resq_state_t (*session_active_run)(network_config_t *network_config,
                                       calibration_config_t *calibration_config,
                                       const char *ip_address);
    bool (*session_has_pending_interruption)(void);
    esp_err_t (*session_publish_pending_interruption)(
        network_config_t *network_config,
        calibration_config_t *calibration_config,
        const char *ip_address);
    bool (*session_sensor_is_running)(void);

    resq_state_t (*error_run)(network_config_t *network_config,
                              calibration_config_t *calibration_config,
                              const char *ip_address);
    esp_err_t (*error_set)(firmware_error_reason_id_t reason_id);

    bool (*session_is_active)(void);
    esp_err_t (*session_get_state)(session_state_t *state);
    esp_err_t (*session_get_id)(char *out_session_id,
                                size_t out_session_id_len);
    esp_err_t (*session_stop)(const char *session_id);

    esp_err_t (*buzzer_stop)(void);
    esp_err_t (*telemetry_stop)(void);
    esp_err_t (*calibration_cancel)(void);

    void (*status_set_state)(resq_state_t state);
    void (*status_stop)(void);
    system_button_action_t (*button_poll)(resq_state_t state);
    void (*button_drain_actions)(resq_state_t state);

    void (*delay_ms)(uint32_t delay_ms);
    void (*restart)(void);
    void (*enter_soft_off)(void);
} resq_fsm_ops_t;

typedef struct {
    resq_state_t current_state;
    bool has_entered_state;
    network_config_t network_config;
    calibration_config_t calibration_config;
    backend_registration_result_t backend_result;
    char ip_address[16];
    const resq_fsm_ops_t *ops;
} resq_fsm_t;

esp_err_t resq_fsm_init(resq_fsm_t *fsm, const resq_fsm_ops_t *ops);
resq_state_t resq_fsm_step(resq_fsm_t *fsm);
void resq_fsm_enter(resq_fsm_t *fsm, resq_state_t state);
resq_state_t resq_fsm_get_state(const resq_fsm_t *fsm);
bool resq_fsm_state_handles_buttons_internally(resq_state_t state);

#ifdef __cplusplus
}
#endif

#endif
