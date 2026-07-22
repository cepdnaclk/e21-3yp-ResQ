#include "firmware_state_machine.h"

#include <string.h>

#include "esp_log.h"
#include "wifi_manager.h"

static const char *TAG = "resq_fsm";

static bool required_ops_present(const resq_fsm_ops_t *ops)
{
    return ops != NULL &&
           ops->initialize_components != NULL &&
           ops->sensor_mode_enabled != NULL &&
           ops->network_set_defaults != NULL &&
           ops->calibration_set_defaults != NULL &&
           ops->network_validate != NULL &&
           ops->calibration_validate != NULL &&
           ops->load_network != NULL &&
           ops->load_calibration != NULL &&
           ops->save_network != NULL &&
           ops->clear_network != NULL &&
           ops->clear_all != NULL &&
           ops->provisioning_start != NULL &&
           ops->provisioning_stop != NULL &&
           ops->provisioning_has_saved_config != NULL &&
           ops->io_mode_get != NULL &&
           ops->io_mode_request != NULL &&
           ops->wifi_connect != NULL &&
           ops->wifi_disconnect != NULL &&
           ops->wifi_is_connected != NULL &&
           ops->wifi_get_ip != NULL &&
           ops->wifi_get_rssi != NULL &&
           ops->backend_register != NULL &&
           ops->mqtt_start != NULL &&
           ops->mqtt_stop != NULL &&
           ops->mqtt_is_connected != NULL &&
           ops->mqtt_publish_identity != NULL &&
           ops->mqtt_publish_status != NULL &&
           ops->mqtt_publish_heartbeat != NULL &&
           ops->start_heartbeat != NULL &&
           ops->stop_heartbeat != NULL &&
           ops->paired_idle_run != NULL &&
           ops->calibration_run != NULL &&
           ops->calibration_fail_run != NULL &&
           ops->session_active_run != NULL &&
           ops->session_has_pending_interruption != NULL &&
           ops->session_publish_pending_interruption != NULL &&
           ops->session_sensor_is_running != NULL &&
           ops->error_run != NULL &&
           ops->error_set != NULL &&
           ops->session_is_active != NULL &&
           ops->session_get_state != NULL &&
           ops->session_get_id != NULL &&
           ops->session_stop != NULL &&
           ops->buzzer_stop != NULL &&
           ops->telemetry_stop != NULL &&
           ops->calibration_cancel != NULL &&
           ops->status_set_state != NULL &&
           ops->status_set_both_leds_on != NULL &&
           ops->status_stop != NULL &&
           ops->button_poll != NULL &&
           ops->button_take_event != NULL &&
           ops->button_drain_events != NULL &&
           ops->button_drain_actions != NULL &&
           ops->delay_ms != NULL &&
           ops->restart != NULL &&
           ops->enter_soft_off != NULL;
}

static void get_runtime_session_values(const resq_fsm_t *fsm,
                                       bool *session_active,
                                       bool *sensor_running,
                                       char *session_id,
                                       size_t session_id_len)
{
    if (session_active != NULL) {
        *session_active = false;
    }
    if (sensor_running != NULL) {
        *sensor_running = fsm->ops->session_sensor_is_running();
    }
    if (session_id != NULL && session_id_len > 0) {
        session_id[0] = '\0';
    }

    session_state_t state = {0};
    if (fsm->ops->session_get_state(&state) != ESP_OK || !state.active) {
        return;
    }

    if (session_active != NULL) {
        *session_active = true;
    }
    if (session_id != NULL && session_id_len > 0) {
        strncpy(session_id, state.session_id, session_id_len - 1);
        session_id[session_id_len - 1] = '\0';
    }
}

static void publish_status_if_connected(resq_fsm_t *fsm, resq_state_t state)
{
    if (!fsm->ops->mqtt_is_connected()) {
        return;
    }
    if (state == RESQ_STATE_SESSION_INTERRUPTED &&
        fsm->ops->session_has_pending_interruption()) {
        return;
    }

    bool session_active = false;
    char session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
    get_runtime_session_values(fsm,
                               &session_active,
                               NULL,
                               session_id,
                               sizeof(session_id));
    fsm->ops->mqtt_publish_status(state,
                                  &fsm->network_config,
                                  &fsm->calibration_config,
                                  session_active,
                                  session_id,
                                  fsm->ip_address);
}

void resq_fsm_enter(resq_fsm_t *fsm, resq_state_t state)
{
    if (fsm == NULL || fsm->ops == NULL) {
        return;
    }
    if (fsm->has_entered_state && fsm->current_state == state) {
        return;
    }

    fsm->current_state = state;
    fsm->has_entered_state = true;
    ESP_LOGI(TAG, "Entering state: %s", resq_state_to_string(state));
    fsm->ops->status_set_state(state);
    publish_status_if_connected(fsm, state);
}

esp_err_t resq_fsm_init(resq_fsm_t *fsm, const resq_fsm_ops_t *ops)
{
    if (fsm == NULL || !required_ops_present(ops)) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(fsm, 0, sizeof(*fsm));
    fsm->ops = ops;
    fsm->current_state = RESQ_STATE_BOOT;
    resq_fsm_enter(fsm, RESQ_STATE_BOOT);
    return ESP_OK;
}

resq_state_t resq_fsm_get_state(const resq_fsm_t *fsm)
{
    return fsm == NULL ? RESQ_STATE_ERROR : fsm->current_state;
}

bool resq_fsm_state_handles_buttons_internally(resq_state_t state)
{
    switch (state) {
    case RESQ_STATE_PROVISIONING:
    case RESQ_STATE_PAIRED_IDLE:
    case RESQ_STATE_READY_FOR_SESSION:
    case RESQ_STATE_CALIBRATING:
    case RESQ_STATE_CALIBRATION_FAIL:
    case RESQ_STATE_SESSION_ACTIVE:
    case RESQ_STATE_ERROR:
        return true;
    default:
        return false;
    }
}

static resq_state_t run_boot(resq_fsm_t *fsm)
{
    if (fsm->ops->initialize_components() != ESP_OK) {
        fsm->ops->error_set(FW_ERROR_NVS_INIT_FAILED);
        return RESQ_STATE_ERROR;
    }

    fsm->ops->network_set_defaults(&fsm->network_config);
    fsm->ops->calibration_set_defaults(&fsm->calibration_config);
    if (fsm->ops->load_network(&fsm->network_config) != ESP_OK) {
        return RESQ_STATE_ERROR;
    }
    if (fsm->ops->load_calibration(&fsm->calibration_config) != ESP_OK) {
        fsm->ops->calibration_set_defaults(&fsm->calibration_config);
    }
    if (!fsm->ops->calibration_validate(&fsm->calibration_config)) {
        fsm->calibration_config.calibrated = false;
    }
    if (!fsm->ops->sensor_mode_enabled()) {
        fsm->calibration_config.calibrated = false;
    }
    return RESQ_STATE_CONFIG_CHECK;
}

static resq_state_t run_config_check(resq_fsm_t *fsm)
{
    return fsm->ops->network_validate(&fsm->network_config)
        ? RESQ_STATE_WIFI_CONNECTING
        : RESQ_STATE_PROVISIONING;
}

static const char *io_mode_name(resq_io_mode_t mode)
{
    return mode == RESQ_IO_MODE_USB ? "USB" : "SENSOR";
}

static void clear_provisioning_io_mode_request(resq_fsm_t *fsm)
{
    fsm->provisioning_io_mode_request.pending = false;
    fsm->provisioning_io_mode_request.target = fsm->ops->io_mode_get();
    fsm->provisioning_io_mode_request.confirmation_in_progress = false;
    fsm->ops->status_set_both_leds_on(false);
}

static void select_provisioning_io_mode(resq_fsm_t *fsm,
                                        resq_io_mode_t requested_mode)
{
    provisioning_io_mode_request_t *request =
        &fsm->provisioning_io_mode_request;
    resq_io_mode_t active_mode = fsm->ops->io_mode_get();

    if (requested_mode == active_mode) {
        bool cancelled = request->pending;
        clear_provisioning_io_mode_request(fsm);
        if (cancelled) {
            ESP_LOGI(TAG,
                     "Provisioning I/O mode selection cancelled; %s is already active",
                     io_mode_name(active_mode));
        } else {
            ESP_LOGI(TAG,
                     "Provisioning I/O mode %s is already active; no change pending",
                     io_mode_name(active_mode));
        }
        return;
    }

    if (request->pending && request->target == requested_mode) {
        ESP_LOGI(TAG, "Provisioning I/O mode %s is already pending",
                 io_mode_name(requested_mode));
        return;
    }

    request->pending = true;
    request->target = requested_mode;
    request->confirmation_in_progress = false;
    fsm->ops->status_set_both_leds_on(true);
    ESP_LOGI(TAG,
             "Provisioning I/O mode selected: active=%s pending=%s; long-press either button to save and restart",
             io_mode_name(active_mode), io_mode_name(requested_mode));
}

static resq_state_t run_provisioning(resq_fsm_t *fsm)
{
    bool mode_retry_required = false;
    bool network_config_saved = false;
    clear_provisioning_io_mode_request(fsm);
    if (fsm->ops->provisioning_start() != ESP_OK) {
        clear_provisioning_io_mode_request(fsm);
        fsm->ops->error_set(FW_ERROR_CONFIG_INVALID);
        return RESQ_STATE_ERROR;
    }

    while (true) {
        system_button_event_t event = {0};
        while (fsm->ops->button_take_event(&event)) {
            provisioning_io_mode_request_t *request =
                &fsm->provisioning_io_mode_request;

            if (event.press_type == SYSTEM_BUTTON_PRESS_SHORT) {
                if (event.button_id == SYSTEM_BUTTON_ID_1) {
                    mode_retry_required = false;
                    select_provisioning_io_mode(fsm, RESQ_IO_MODE_USB);
                } else if (event.button_id == SYSTEM_BUTTON_ID_2) {
                    mode_retry_required = false;
                    select_provisioning_io_mode(fsm, RESQ_IO_MODE_SENSOR);
                }
                continue;
            }

            if (event.press_type != SYSTEM_BUTTON_PRESS_LONG) {
                continue;
            }

            if (request->pending) {
                if (request->confirmation_in_progress) {
                    ESP_LOGW(TAG, "Ignoring duplicate I/O mode confirmation");
                    continue;
                }

                request->confirmation_in_progress = true;
                resq_io_mode_t target = request->target;
                resq_io_mode_t active = fsm->ops->io_mode_get();
                ESP_LOGW(TAG,
                         "Confirming provisioning I/O mode switch: active=%s requested=%s",
                         io_mode_name(active), io_mode_name(target));

                if (fsm->ops->provisioning_has_saved_config()) {
                    network_config_saved = true;
                }
                esp_err_t stop_err = fsm->ops->provisioning_stop();
                if (stop_err != ESP_OK) {
                    ESP_LOGE(TAG,
                             "I/O mode switch aborted because provisioning could not stop: %s",
                             esp_err_to_name(stop_err));
                    clear_provisioning_io_mode_request(fsm);
                    fsm->ops->button_drain_events(RESQ_STATE_PROVISIONING);
                    mode_retry_required = true;
                    if (fsm->ops->provisioning_start() != ESP_OK) {
                        fsm->ops->error_set(FW_ERROR_CONFIG_INVALID);
                        return RESQ_STATE_ERROR;
                    }
                    continue;
                }

                esp_err_t save_err = fsm->ops->io_mode_request(target);
                if (save_err != ESP_OK) {
                    ESP_LOGE(TAG,
                             "I/O mode switch aborted because NVS save failed: %s",
                             esp_err_to_name(save_err));
                    clear_provisioning_io_mode_request(fsm);
                    fsm->ops->button_drain_events(RESQ_STATE_PROVISIONING);
                    mode_retry_required = true;
                    if (fsm->ops->provisioning_start() != ESP_OK) {
                        fsm->ops->error_set(FW_ERROR_CONFIG_INVALID);
                        return RESQ_STATE_ERROR;
                    }
                    continue;
                }

                /* Keep the override active until the reboot takes effect. */
                fsm->ops->status_set_both_leds_on(true);
                fsm->ops->button_drain_events(RESQ_STATE_PROVISIONING);
                fsm->ops->delay_ms(200);
                ESP_LOGW(TAG, "Restarting into %s I/O mode",
                         io_mode_name(target));
                fsm->ops->restart();
                return RESQ_STATE_PROVISIONING;
            }

            resq_state_t next_state = RESQ_STATE_PROVISIONING;
            if (event.button_id == SYSTEM_BUTTON_ID_1) {
                next_state = RESQ_STATE_TURN_OFF;
            } else if (event.button_id == SYSTEM_BUTTON_ID_2) {
                next_state = RESQ_STATE_RESETTING;
            } else {
                continue;
            }

            esp_err_t stop_err = fsm->ops->provisioning_stop();
            clear_provisioning_io_mode_request(fsm);
            fsm->ops->button_drain_events(RESQ_STATE_PROVISIONING);
            if (stop_err != ESP_OK) {
                ESP_LOGE(TAG, "Provisioning stop failed: %s",
                         esp_err_to_name(stop_err));
                fsm->ops->error_set(FW_ERROR_CONFIG_INVALID);
                return RESQ_STATE_ERROR;
            }
            return next_state;
        }

        /* Button events are deliberately polled before this exit check. */
        if (fsm->ops->provisioning_has_saved_config()) {
            network_config_saved = true;
        }
        if (network_config_saved &&
            !fsm->provisioning_io_mode_request.pending &&
            !mode_retry_required) {
            break;
        }
        fsm->ops->delay_ms(50);
    }

    esp_err_t stop_err = fsm->ops->provisioning_stop();
    clear_provisioning_io_mode_request(fsm);
    fsm->ops->button_drain_events(RESQ_STATE_PROVISIONING);
    if (stop_err != ESP_OK) {
        fsm->ops->error_set(FW_ERROR_CONFIG_INVALID);
        return RESQ_STATE_ERROR;
    }
    fsm->ops->network_set_defaults(&fsm->network_config);
    if (fsm->ops->load_network(&fsm->network_config) != ESP_OK) {
        return RESQ_STATE_ERROR;
    }
    if (!fsm->ops->network_validate(&fsm->network_config)) {
        return RESQ_STATE_PROVISIONING;
    }
    return RESQ_STATE_WIFI_CONNECTING;
}

static resq_state_t run_flush_config(resq_fsm_t *fsm)
{
    fsm->ops->mqtt_stop();
    fsm->ops->wifi_disconnect();
    fsm->ops->provisioning_stop();
    if (fsm->ops->clear_network() != ESP_OK) {
        return RESQ_STATE_ERROR;
    }
    fsm->ops->network_set_defaults(&fsm->network_config);
    return RESQ_STATE_PROVISIONING;
}

static resq_state_t run_wifi_connecting(resq_fsm_t *fsm)
{
    if (!fsm->ops->network_validate(&fsm->network_config)) {
        return RESQ_STATE_FLUSH_CONFIG;
    }
    if (fsm->ops->wifi_connect(fsm->network_config.wifi_ssid,
                               fsm->network_config.wifi_pass,
                               WIFI_MANAGER_DEFAULT_MAX_RETRIES,
                               WIFI_MANAGER_DEFAULT_TIMEOUT_MS) != ESP_OK) {
        fsm->ops->error_set(FW_ERROR_WIFI_CONNECT_FAILED);
        return RESQ_STATE_ERROR;
    }
    if (fsm->ops->wifi_get_ip(fsm->ip_address,
                              sizeof(fsm->ip_address)) != ESP_OK) {
        fsm->ip_address[0] = '\0';
    }
    return RESQ_STATE_BACKEND_REGISTERING;
}

static resq_state_t run_backend_registering(resq_fsm_t *fsm)
{
    ESP_LOGI(TAG, "Backend registration start mode=%s",
             fsm->ops->sensor_mode_enabled() ? "SENSOR" : "USB");
    backend_registration_result_t result = {0};
    esp_err_t registration_err = fsm->ops->backend_register(
        &fsm->network_config, &result);
    if (registration_err != ESP_OK) {
        fsm->ops->error_set(registration_err == ESP_ERR_INVALID_RESPONSE
            ? FW_ERROR_BACKEND_INVALID_RESPONSE
            : FW_ERROR_BACKEND_REGISTER_FAILED);
        return RESQ_STATE_ERROR;
    }
    if (result.device_id[0] == '\0') {
        fsm->ops->error_set(FW_ERROR_BACKEND_INVALID_RESPONSE);
        return RESQ_STATE_ERROR;
    }
    memcpy(&fsm->backend_result, &result, sizeof(result));
    return RESQ_STATE_MQTT_CONNECTING;
}

static resq_state_t run_mqtt_connecting(resq_fsm_t *fsm)
{
    if (fsm->ops->mqtt_start(fsm->backend_result.device_id,
                             fsm->backend_result.mqtt_host,
                             fsm->backend_result.mqtt_port) != ESP_OK) {
        fsm->ops->error_set(FW_ERROR_MQTT_CONNECT_FAILED);
        return RESQ_STATE_ERROR;
    }

    fsm->ops->mqtt_publish_identity(&fsm->network_config);
    fsm->ops->calibration_validate(&fsm->calibration_config);

    resq_state_t next_state;
    if (!fsm->ops->sensor_mode_enabled()) {
        next_state = RESQ_STATE_PAIRED_IDLE;
    } else if (fsm->ops->session_has_pending_interruption()) {
        next_state = RESQ_STATE_SESSION_INTERRUPTED;
    } else {
        next_state = fsm->calibration_config.calibrated
            ? RESQ_STATE_READY_FOR_SESSION
            : RESQ_STATE_PAIRED_IDLE;
    }

    fsm->ops->start_heartbeat();

    bool session_active = false;
    bool sensor_running = false;
    char session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
    get_runtime_session_values(fsm,
                               &session_active,
                               &sensor_running,
                               session_id,
                               sizeof(session_id));
    fsm->ops->mqtt_publish_heartbeat(&fsm->network_config,
                                     &fsm->calibration_config,
                                     next_state,
                                     session_active,
                                     sensor_running,
                                     session_id,
                                     fsm->ip_address,
                                     fsm->ops->wifi_get_rssi());
    return next_state;
}

static resq_state_t run_idle(resq_fsm_t *fsm, resq_state_t state)
{
    fsm->ops->status_set_state(state);
    if (fsm->ops->mqtt_is_connected()) {
        fsm->ops->mqtt_publish_status(state,
                                      &fsm->network_config,
                                      &fsm->calibration_config,
                                      false,
                                      "",
                                      fsm->ip_address);
    }
    return fsm->ops->paired_idle_run(&fsm->network_config,
                                     &fsm->calibration_config,
                                     fsm->ip_address);
}

static resq_state_t run_session_interrupted(resq_fsm_t *fsm)
{
    if (!fsm->ops->sensor_mode_enabled()) {
        return RESQ_STATE_PAIRED_IDLE;
    }
    fsm->ops->status_set_state(RESQ_STATE_SESSION_INTERRUPTED);
    if (!fsm->ops->wifi_is_connected()) {
        return RESQ_STATE_WIFI_CONNECTING;
    }
    if (!fsm->ops->mqtt_is_connected()) {
        return RESQ_STATE_MQTT_CONNECTING;
    }
    if (fsm->ops->session_publish_pending_interruption(
            &fsm->network_config,
            &fsm->calibration_config,
            fsm->ip_address) != ESP_OK) {
        fsm->ops->delay_ms(500);
        return RESQ_STATE_SESSION_INTERRUPTED;
    }
    return fsm->calibration_config.calibrated
        ? RESQ_STATE_READY_FOR_SESSION
        : RESQ_STATE_PAIRED_IDLE;
}

static esp_err_t preserve_first_error(esp_err_t current, esp_err_t candidate)
{
    return current == ESP_OK && candidate != ESP_OK ? candidate : current;
}

static esp_err_t stop_runtime(resq_fsm_t *fsm)
{
    esp_err_t result = ESP_OK;
    result = preserve_first_error(result, fsm->ops->buzzer_stop());
    result = preserve_first_error(result, fsm->ops->telemetry_stop());
    if (fsm->ops->session_is_active()) {
        char session_id[RESQ_SESSION_ID_MAX_LEN] = {0};
        if (fsm->ops->session_get_id(session_id, sizeof(session_id)) == ESP_OK &&
            session_id[0] != '\0') {
            result = preserve_first_error(result,
                                          fsm->ops->session_stop(session_id));
        }
    }
    result = preserve_first_error(result, fsm->ops->calibration_cancel());
    return result;
}

static resq_state_t run_resetting(resq_fsm_t *fsm)
{
    fsm->ops->status_set_state(RESQ_STATE_RESETTING);
    esp_err_t cleanup_err = stop_runtime(fsm);
    if (fsm->ops->mqtt_is_connected()) {
        fsm->ops->mqtt_publish_status(RESQ_STATE_RESETTING,
                                      &fsm->network_config,
                                      &fsm->calibration_config,
                                      false,
                                      "",
                                      fsm->ip_address);
        fsm->ops->delay_ms(300);
    }
    esp_err_t clear_err = fsm->ops->clear_all();
    if (cleanup_err != ESP_OK || clear_err != ESP_OK) {
        ESP_LOGE(TAG, "Reset cleanup failed: runtime=%s nvs=%s",
                 esp_err_to_name(cleanup_err), esp_err_to_name(clear_err));
        fsm->ops->error_set(clear_err != ESP_OK ? FW_ERROR_NVS_SAVE_FAILED
                                                : FW_ERROR_UNKNOWN_ERROR);
        return RESQ_STATE_ERROR;
    }
    esp_err_t shutdown_err = fsm->ops->stop_heartbeat();
    shutdown_err = preserve_first_error(shutdown_err, fsm->ops->mqtt_stop());
    shutdown_err = preserve_first_error(shutdown_err,
                                        fsm->ops->wifi_disconnect());
    if (shutdown_err != ESP_OK) {
        fsm->ops->error_set(FW_ERROR_UNKNOWN_ERROR);
        return RESQ_STATE_ERROR;
    }
    fsm->ops->delay_ms(200);
    fsm->ops->restart();
    return RESQ_STATE_RESETTING;
}

static resq_state_t run_turn_off(resq_fsm_t *fsm)
{
    fsm->ops->status_set_state(RESQ_STATE_TURN_OFF);
    esp_err_t result = stop_runtime(fsm);
    result = preserve_first_error(result,
                                  fsm->ops->save_network(&fsm->network_config));
    if (fsm->ops->mqtt_is_connected()) {
        fsm->ops->mqtt_publish_status(RESQ_STATE_TURN_OFF,
                                      &fsm->network_config,
                                      &fsm->calibration_config,
                                      false,
                                      "",
                                      fsm->ip_address);
        fsm->ops->delay_ms(300);
    }
    result = preserve_first_error(result, fsm->ops->stop_heartbeat());
    result = preserve_first_error(result, fsm->ops->mqtt_stop());
    result = preserve_first_error(result, fsm->ops->wifi_disconnect());
    if (result != ESP_OK) {
        ESP_LOGE(TAG, "Turn-off cleanup failed: %s", esp_err_to_name(result));
        fsm->ops->error_set(FW_ERROR_UNKNOWN_ERROR);
        return RESQ_STATE_ERROR;
    }
    fsm->ops->status_stop();
    fsm->ops->enter_soft_off();
    return RESQ_STATE_TURN_OFF;
}

static resq_state_t dispatch_state(resq_fsm_t *fsm)
{
    switch (fsm->current_state) {
    case RESQ_STATE_BOOT:
        return run_boot(fsm);
    case RESQ_STATE_CONFIG_CHECK:
        return run_config_check(fsm);
    case RESQ_STATE_PROVISIONING:
        return run_provisioning(fsm);
    case RESQ_STATE_FLUSH_CONFIG:
        return run_flush_config(fsm);
    case RESQ_STATE_WIFI_CONNECTING:
        return run_wifi_connecting(fsm);
    case RESQ_STATE_BACKEND_REGISTERING:
        return run_backend_registering(fsm);
    case RESQ_STATE_MQTT_CONNECTING:
        return run_mqtt_connecting(fsm);
    case RESQ_STATE_PAIRED_IDLE:
        return run_idle(fsm, RESQ_STATE_PAIRED_IDLE);
    case RESQ_STATE_CALIBRATING:
        if (!fsm->ops->sensor_mode_enabled()) {
            return RESQ_STATE_PAIRED_IDLE;
        }
        return fsm->ops->calibration_run(&fsm->network_config,
                                         &fsm->calibration_config,
                                         fsm->ip_address);
    case RESQ_STATE_CALIBRATION_FAIL:
        return fsm->ops->calibration_fail_run(&fsm->network_config,
                                              &fsm->calibration_config,
                                              fsm->ip_address);
    case RESQ_STATE_READY_FOR_SESSION:
        return run_idle(fsm, RESQ_STATE_READY_FOR_SESSION);
    case RESQ_STATE_SESSION_ACTIVE:
        if (!fsm->ops->sensor_mode_enabled()) {
            return RESQ_STATE_PAIRED_IDLE;
        }
        return fsm->ops->session_active_run(&fsm->network_config,
                                            &fsm->calibration_config,
                                            fsm->ip_address);
    case RESQ_STATE_SESSION_INTERRUPTED:
        return run_session_interrupted(fsm);
    case RESQ_STATE_ERROR:
        return fsm->ops->error_run(&fsm->network_config,
                                   &fsm->calibration_config,
                                   fsm->ip_address);
    case RESQ_STATE_RESETTING:
        return run_resetting(fsm);
    case RESQ_STATE_TURN_OFF:
        return run_turn_off(fsm);
    default:
        fsm->ops->error_set(FW_ERROR_UNSUPPORTED_STATE);
        return RESQ_STATE_ERROR;
    }
}

resq_state_t resq_fsm_step(resq_fsm_t *fsm)
{
    if (fsm == NULL || fsm->ops == NULL) {
        return RESQ_STATE_ERROR;
    }

    resq_state_t handled_state = fsm->current_state;
    resq_state_t next_state = dispatch_state(fsm);

    if (!resq_fsm_state_handles_buttons_internally(handled_state)) {
        system_button_action_t action = fsm->ops->button_poll(handled_state);
        if (action == SYSTEM_BUTTON_ACTION_TURN_OFF) {
            next_state = RESQ_STATE_TURN_OFF;
        } else if (action == SYSTEM_BUTTON_ACTION_FACTORY_RESET) {
            next_state = RESQ_STATE_RESETTING;
        }
    } else {
        fsm->ops->button_drain_actions(handled_state);
    }

    if (next_state != fsm->current_state) {
        resq_fsm_enter(fsm, next_state);
    }
    return fsm->current_state;
}
