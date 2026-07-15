#include <string.h>

#include "firmware_state_machine.h"
#include "unity.h"

typedef struct {
    esp_err_t initialize_result;
    esp_err_t load_network_result;
    esp_err_t load_calibration_result;
    esp_err_t clear_network_result;
    esp_err_t clear_all_result;
    esp_err_t provisioning_start_result;
    esp_err_t provisioning_stop_result;
    int provisioning_saved_after;
    int provisioning_checks;
    esp_err_t wifi_connect_result;
    esp_err_t wifi_get_ip_result;
    bool wifi_connected;
    int wifi_rssi;
    esp_err_t backend_result;
    backend_registration_result_t backend_data;
    esp_err_t mqtt_start_result;
    bool mqtt_connected;
    esp_err_t identity_result;
    esp_err_t heartbeat_result;
    esp_err_t pending_publish_result;
    bool pending_interruption;
    bool sensor_running;
    bool sensor_mode_enabled;
    bool network_valid;
    bool calibration_valid;
    resq_state_t paired_idle_result;
    resq_state_t calibration_result;
    resq_state_t calibration_fail_result;
    resq_state_t session_active_result;
    resq_state_t error_result;
    system_button_action_t button_actions[4];
    size_t button_action_count;
    size_t button_action_index;
    bool session_active;
    session_state_t session_state;
    const char *session_id;
    firmware_error_reason_id_t last_error;
    int status_calls;
    int publish_status_calls;
    int heartbeat_calls;
    int identity_calls;
    int heartbeat_start_calls;
    int heartbeat_stop_calls;
    int drain_calls;
    int delay_calls;
    uint32_t last_delay_ms;
    int mqtt_stop_calls;
    int wifi_disconnect_calls;
    int provisioning_stop_calls;
    int clear_network_calls;
    int clear_all_calls;
    int save_network_calls;
    int buzzer_stop_calls;
    int telemetry_stop_calls;
    int session_stop_calls;
    int calibration_cancel_calls;
    int restart_calls;
    int soft_off_calls;
    int status_stop_calls;
} fake_t;

static fake_t f;
static resq_fsm_t fsm;

static esp_err_t fake_initialize(void) { return f.initialize_result; }
static bool fake_sensor_mode_enabled(void) { return f.sensor_mode_enabled; }
static void fake_network_defaults(network_config_t *config)
{
    memset(config, 0, sizeof(*config));
}
static void fake_calibration_defaults(calibration_config_t *config)
{
    memset(config, 0, sizeof(*config));
}
static bool fake_network_validate(network_config_t *config)
{
    config->provisioned = f.network_valid;
    return f.network_valid;
}
static bool fake_calibration_validate(calibration_config_t *config)
{
    (void)config;
    return f.calibration_valid;
}
static esp_err_t fake_load_network(network_config_t *config)
{
    if (f.load_network_result == ESP_OK) {
        strcpy(config->wifi_ssid, "resq-test");
        strcpy(config->backend_base_url, "http://test");
    }
    return f.load_network_result;
}
static esp_err_t fake_load_calibration(calibration_config_t *config)
{
    config->calibrated = f.calibration_valid;
    return f.load_calibration_result;
}
static esp_err_t fake_save_network(network_config_t *config)
{
    (void)config;
    f.save_network_calls++;
    return ESP_OK;
}
static esp_err_t fake_clear_network(void)
{
    f.clear_network_calls++;
    return f.clear_network_result;
}
static esp_err_t fake_clear_all(void)
{
    f.clear_all_calls++;
    return f.clear_all_result;
}
static esp_err_t fake_provisioning_start(void)
{
    return f.provisioning_start_result;
}
static esp_err_t fake_provisioning_stop(void)
{
    f.provisioning_stop_calls++;
    return f.provisioning_stop_result;
}
static bool fake_provisioning_has_saved(void)
{
    f.provisioning_checks++;
    return f.provisioning_checks > f.provisioning_saved_after;
}
static esp_err_t fake_wifi_connect(const char *ssid,
                                   const char *password,
                                   int retries,
                                   int timeout_ms)
{
    (void)ssid;
    (void)password;
    (void)retries;
    (void)timeout_ms;
    return f.wifi_connect_result;
}
static esp_err_t fake_wifi_disconnect(void)
{
    f.wifi_disconnect_calls++;
    return ESP_OK;
}
static bool fake_wifi_is_connected(void) { return f.wifi_connected; }
static esp_err_t fake_wifi_get_ip(char *buffer, size_t buffer_len)
{
    if (f.wifi_get_ip_result == ESP_OK) {
        strncpy(buffer, "192.0.2.10", buffer_len);
    }
    return f.wifi_get_ip_result;
}
static int fake_wifi_get_rssi(void) { return f.wifi_rssi; }
static esp_err_t fake_backend_register(const network_config_t *config,
                                       backend_registration_result_t *result)
{
    (void)config;
    *result = f.backend_data;
    return f.backend_result;
}
static esp_err_t fake_mqtt_start(const char *device_id,
                                 const char *host,
                                 int port)
{
    (void)device_id;
    (void)host;
    (void)port;
    return f.mqtt_start_result;
}
static esp_err_t fake_mqtt_stop(void)
{
    f.mqtt_stop_calls++;
    return ESP_OK;
}
static bool fake_mqtt_is_connected(void) { return f.mqtt_connected; }
static esp_err_t fake_publish_identity(const network_config_t *config)
{
    (void)config;
    f.identity_calls++;
    return f.identity_result;
}
static esp_err_t fake_publish_status(resq_state_t state,
                                     const network_config_t *network,
                                     const calibration_config_t *calibration,
                                     bool session_active,
                                     const char *session_id,
                                     const char *ip)
{
    (void)state;
    (void)network;
    (void)calibration;
    (void)session_active;
    (void)session_id;
    (void)ip;
    f.publish_status_calls++;
    return ESP_OK;
}
static esp_err_t fake_publish_heartbeat(const network_config_t *network,
                                        const calibration_config_t *calibration,
                                        resq_state_t state,
                                        bool session_active,
                                        bool sensor_running,
                                        const char *session_id,
                                        const char *ip,
                                        int rssi)
{
    (void)network;
    (void)calibration;
    (void)state;
    (void)session_active;
    (void)sensor_running;
    (void)session_id;
    (void)ip;
    (void)rssi;
    f.heartbeat_calls++;
    return f.heartbeat_result;
}
static esp_err_t fake_start_heartbeat(void)
{
    f.heartbeat_start_calls++;
    return ESP_OK;
}
static resq_state_t fake_paired_idle(network_config_t *network,
                                     calibration_config_t *calibration,
                                     const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.paired_idle_result;
}
static resq_state_t fake_calibration(network_config_t *network,
                                     calibration_config_t *calibration,
                                     const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.calibration_result;
}
static resq_state_t fake_calibration_fail(network_config_t *network,
                                          calibration_config_t *calibration,
                                          const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.calibration_fail_result;
}
static resq_state_t fake_session_active(network_config_t *network,
                                        calibration_config_t *calibration,
                                        const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.session_active_result;
}
static bool fake_has_pending(void) { return f.pending_interruption; }
static esp_err_t fake_publish_pending(network_config_t *network,
                                      calibration_config_t *calibration,
                                      const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.pending_publish_result;
}
static bool fake_sensor_running(void) { return f.sensor_running; }
static resq_state_t fake_error_run(network_config_t *network,
                                   calibration_config_t *calibration,
                                   const char *ip)
{
    (void)network;
    (void)calibration;
    (void)ip;
    return f.error_result;
}
static esp_err_t fake_error_set(firmware_error_reason_id_t reason)
{
    f.last_error = reason;
    return ESP_OK;
}
static bool fake_session_is_active(void) { return f.session_active; }
static esp_err_t fake_session_get_state(session_state_t *state)
{
    *state = f.session_state;
    return ESP_OK;
}
static esp_err_t fake_session_get_id(char *out_session_id, size_t out_len)
{
    if (out_session_id == NULL || out_len == 0) return ESP_ERR_INVALID_ARG;
    strncpy(out_session_id, f.session_id, out_len - 1);
    out_session_id[out_len - 1] = '\0';
    return ESP_OK;
}
static esp_err_t fake_stop_heartbeat(void)
{
    f.heartbeat_stop_calls++;
    return ESP_OK;
}
static esp_err_t fake_session_stop(const char *session_id)
{
    (void)session_id;
    f.session_stop_calls++;
    return ESP_OK;
}
static esp_err_t fake_buzzer_stop(void)
{
    f.buzzer_stop_calls++;
    return ESP_OK;
}
static esp_err_t fake_telemetry_stop(void)
{
    f.telemetry_stop_calls++;
    return ESP_OK;
}
static esp_err_t fake_calibration_cancel(void)
{
    f.calibration_cancel_calls++;
    return ESP_OK;
}
static void fake_status_set(resq_state_t state)
{
    (void)state;
    f.status_calls++;
}
static void fake_status_stop(void) { f.status_stop_calls++; }
static system_button_action_t fake_button_poll(resq_state_t state)
{
    (void)state;
    if (f.button_action_index < f.button_action_count) {
        return f.button_actions[f.button_action_index++];
    }
    return SYSTEM_BUTTON_ACTION_NONE;
}
static void fake_button_drain(resq_state_t state)
{
    (void)state;
    f.drain_calls++;
}
static void fake_delay(uint32_t delay_ms)
{
    f.delay_calls++;
    f.last_delay_ms = delay_ms;
}
static void fake_restart(void) { f.restart_calls++; }
static void fake_soft_off(void) { f.soft_off_calls++; }

static const resq_fsm_ops_t ops = {
    .initialize_components = fake_initialize,
    .sensor_mode_enabled = fake_sensor_mode_enabled,
    .network_set_defaults = fake_network_defaults,
    .calibration_set_defaults = fake_calibration_defaults,
    .network_validate = fake_network_validate,
    .calibration_validate = fake_calibration_validate,
    .load_network = fake_load_network,
    .load_calibration = fake_load_calibration,
    .save_network = fake_save_network,
    .clear_network = fake_clear_network,
    .clear_all = fake_clear_all,
    .provisioning_start = fake_provisioning_start,
    .provisioning_stop = fake_provisioning_stop,
    .provisioning_has_saved_config = fake_provisioning_has_saved,
    .wifi_connect = fake_wifi_connect,
    .wifi_disconnect = fake_wifi_disconnect,
    .wifi_is_connected = fake_wifi_is_connected,
    .wifi_get_ip = fake_wifi_get_ip,
    .wifi_get_rssi = fake_wifi_get_rssi,
    .backend_register = fake_backend_register,
    .mqtt_start = fake_mqtt_start,
    .mqtt_stop = fake_mqtt_stop,
    .mqtt_is_connected = fake_mqtt_is_connected,
    .mqtt_publish_identity = fake_publish_identity,
    .mqtt_publish_status = fake_publish_status,
    .mqtt_publish_heartbeat = fake_publish_heartbeat,
    .start_heartbeat = fake_start_heartbeat,
    .stop_heartbeat = fake_stop_heartbeat,
    .paired_idle_run = fake_paired_idle,
    .calibration_run = fake_calibration,
    .calibration_fail_run = fake_calibration_fail,
    .session_active_run = fake_session_active,
    .session_has_pending_interruption = fake_has_pending,
    .session_publish_pending_interruption = fake_publish_pending,
    .session_sensor_is_running = fake_sensor_running,
    .error_run = fake_error_run,
    .error_set = fake_error_set,
    .session_is_active = fake_session_is_active,
    .session_get_state = fake_session_get_state,
    .session_get_id = fake_session_get_id,
    .session_stop = fake_session_stop,
    .buzzer_stop = fake_buzzer_stop,
    .telemetry_stop = fake_telemetry_stop,
    .calibration_cancel = fake_calibration_cancel,
    .status_set_state = fake_status_set,
    .status_stop = fake_status_stop,
    .button_poll = fake_button_poll,
    .button_drain_actions = fake_button_drain,
    .delay_ms = fake_delay,
    .restart = fake_restart,
    .enter_soft_off = fake_soft_off,
};

static void reset_fixture(void)
{
    memset(&f, 0, sizeof(f));
    f.initialize_result = ESP_OK;
    f.load_network_result = ESP_OK;
    f.load_calibration_result = ESP_OK;
    f.clear_network_result = ESP_OK;
    f.clear_all_result = ESP_OK;
    f.provisioning_start_result = ESP_OK;
    f.provisioning_stop_result = ESP_OK;
    f.wifi_connect_result = ESP_OK;
    f.wifi_get_ip_result = ESP_OK;
    f.wifi_connected = true;
    f.wifi_rssi = -45;
    f.network_valid = true;
    f.calibration_valid = true;
    f.backend_result = ESP_OK;
    strcpy(f.backend_data.device_id, "device-1");
    strcpy(f.backend_data.mqtt_host, "broker");
    f.backend_data.mqtt_port = 1883;
    f.mqtt_start_result = ESP_OK;
    f.mqtt_connected = true;
    f.identity_result = ESP_OK;
    f.heartbeat_result = ESP_OK;
    f.pending_publish_result = ESP_OK;
    f.sensor_mode_enabled = true;
    f.paired_idle_result = RESQ_STATE_PAIRED_IDLE;
    f.calibration_result = RESQ_STATE_READY_FOR_SESSION;
    f.calibration_fail_result = RESQ_STATE_PAIRED_IDLE;
    f.session_active_result = RESQ_STATE_READY_FOR_SESSION;
    f.error_result = RESQ_STATE_RESETTING;
    f.session_id = "session-1";
    TEST_ASSERT_EQUAL(ESP_OK, resq_fsm_init(&fsm, &ops));
}

static resq_state_t run_state(resq_state_t state)
{
    resq_fsm_enter(&fsm, state);
    return resq_fsm_step(&fsm);
}

TEST_CASE("FSM rejects missing dependencies", "[fsm]")
{
    resq_fsm_t local;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, resq_fsm_init(&local, NULL));
}

TEST_CASE("BOOT covers success and initialization failure", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_CONFIG_CHECK, run_state(RESQ_STATE_BOOT));

    reset_fixture();
    f.initialize_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_BOOT));
    TEST_ASSERT_EQUAL(FW_ERROR_NVS_INIT_FAILED, f.last_error);
}

TEST_CASE("BOOT handles config load failures", "[fsm]")
{
    reset_fixture();
    f.load_network_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_BOOT));

    reset_fixture();
    f.load_calibration_result = ESP_FAIL;
    f.calibration_valid = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_CONFIG_CHECK, run_state(RESQ_STATE_BOOT));
    TEST_ASSERT_FALSE(fsm.calibration_config.calibrated);
}

TEST_CASE("CONFIG_CHECK selects provisioning or Wi-Fi", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_WIFI_CONNECTING,
                      run_state(RESQ_STATE_CONFIG_CHECK));
    reset_fixture();
    f.network_valid = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_PROVISIONING,
                      run_state(RESQ_STATE_CONFIG_CHECK));
}

TEST_CASE("PROVISIONING covers start save validation and turn off", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_WIFI_CONNECTING,
                      run_state(RESQ_STATE_PROVISIONING));

    reset_fixture();
    f.provisioning_start_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_PROVISIONING));
    TEST_ASSERT_EQUAL(FW_ERROR_CONFIG_INVALID, f.last_error);

    reset_fixture();
    f.load_network_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_PROVISIONING));

    reset_fixture();
    f.network_valid = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_PROVISIONING,
                      run_state(RESQ_STATE_PROVISIONING));

    reset_fixture();
    f.provisioning_saved_after = 2;
    f.button_actions[0] = SYSTEM_BUTTON_ACTION_FACTORY_RESET;
    f.button_actions[1] = SYSTEM_BUTTON_ACTION_TURN_OFF;
    f.button_action_count = 2;
    TEST_ASSERT_EQUAL(RESQ_STATE_TURN_OFF,
                      run_state(RESQ_STATE_PROVISIONING));
}

TEST_CASE("FLUSH_CONFIG shuts down and clears network config", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_PROVISIONING,
                      run_state(RESQ_STATE_FLUSH_CONFIG));
    TEST_ASSERT_EQUAL(1, f.mqtt_stop_calls);
    TEST_ASSERT_EQUAL(1, f.wifi_disconnect_calls);
    TEST_ASSERT_EQUAL(1, f.clear_network_calls);

    reset_fixture();
    f.clear_network_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_FLUSH_CONFIG));
}

TEST_CASE("WIFI_CONNECTING covers invalid config failure and IP fallback", "[fsm]")
{
    reset_fixture();
    f.network_valid = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_FLUSH_CONFIG,
                      run_state(RESQ_STATE_WIFI_CONNECTING));

    reset_fixture();
    f.wifi_connect_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_WIFI_CONNECTING));
    TEST_ASSERT_EQUAL(FW_ERROR_WIFI_CONNECT_FAILED, f.last_error);

    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_BACKEND_REGISTERING,
                      run_state(RESQ_STATE_WIFI_CONNECTING));
    TEST_ASSERT_EQUAL_STRING("192.0.2.10", fsm.ip_address);

    reset_fixture();
    f.wifi_get_ip_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_BACKEND_REGISTERING,
                      run_state(RESQ_STATE_WIFI_CONNECTING));
    TEST_ASSERT_EQUAL_CHAR('\0', fsm.ip_address[0]);
}

TEST_CASE("BACKEND_REGISTERING validates the runtime result", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_MQTT_CONNECTING,
                      run_state(RESQ_STATE_BACKEND_REGISTERING));
    TEST_ASSERT_EQUAL_STRING("device-1", fsm.backend_result.device_id);

    reset_fixture();
    f.backend_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR,
                      run_state(RESQ_STATE_BACKEND_REGISTERING));
    TEST_ASSERT_EQUAL(FW_ERROR_BACKEND_REGISTER_FAILED, f.last_error);

    reset_fixture();
    f.backend_data.device_id[0] = '\0';
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR,
                      run_state(RESQ_STATE_BACKEND_REGISTERING));
    TEST_ASSERT_EQUAL(FW_ERROR_BACKEND_INVALID_RESPONSE, f.last_error);
}

TEST_CASE("MQTT_CONNECTING selects all destinations", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_READY_FOR_SESSION,
                      run_state(RESQ_STATE_MQTT_CONNECTING));
    TEST_ASSERT_EQUAL(1, f.identity_calls);
    TEST_ASSERT_EQUAL(1, f.heartbeat_calls);
    TEST_ASSERT_EQUAL(1, f.heartbeat_start_calls);

    reset_fixture();
    f.calibration_valid = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_MQTT_CONNECTING));

    reset_fixture();
    f.pending_interruption = true;
    TEST_ASSERT_EQUAL(RESQ_STATE_SESSION_INTERRUPTED,
                      run_state(RESQ_STATE_MQTT_CONNECTING));

    reset_fixture();
    f.mqtt_start_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR,
                      run_state(RESQ_STATE_MQTT_CONNECTING));
    TEST_ASSERT_EQUAL(FW_ERROR_MQTT_CONNECT_FAILED, f.last_error);
}

TEST_CASE("Idle states delegate commands and publish when connected", "[fsm]")
{
    reset_fixture();
    f.paired_idle_result = RESQ_STATE_CALIBRATING;
    TEST_ASSERT_EQUAL(RESQ_STATE_CALIBRATING,
                      run_state(RESQ_STATE_PAIRED_IDLE));
    TEST_ASSERT_TRUE(f.publish_status_calls > 0);

    reset_fixture();
    f.paired_idle_result = RESQ_STATE_SESSION_ACTIVE;
    TEST_ASSERT_EQUAL(RESQ_STATE_SESSION_ACTIVE,
                      run_state(RESQ_STATE_READY_FOR_SESSION));

    reset_fixture();
    f.mqtt_connected = false;
    int publish_status_before = f.publish_status_calls;
    run_state(RESQ_STATE_PAIRED_IDLE);
    TEST_ASSERT_EQUAL(publish_status_before, f.publish_status_calls);
}

TEST_CASE("Manager-owned states return delegated transitions", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_READY_FOR_SESSION,
                      run_state(RESQ_STATE_CALIBRATING));
    TEST_ASSERT_TRUE(f.drain_calls > 0);

    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_CALIBRATION_FAIL));

    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_READY_FOR_SESSION,
                      run_state(RESQ_STATE_SESSION_ACTIVE));

    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_RESETTING, run_state(RESQ_STATE_ERROR));
    TEST_ASSERT_EQUAL(1, f.telemetry_stop_calls);
}

TEST_CASE("SESSION_INTERRUPTED reconnects retries and returns readiness", "[fsm]")
{
    reset_fixture();
    f.wifi_connected = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_WIFI_CONNECTING,
                      run_state(RESQ_STATE_SESSION_INTERRUPTED));

    reset_fixture();
    f.mqtt_connected = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_MQTT_CONNECTING,
                      run_state(RESQ_STATE_SESSION_INTERRUPTED));

    reset_fixture();
    f.pending_publish_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_SESSION_INTERRUPTED,
                      run_state(RESQ_STATE_SESSION_INTERRUPTED));
    TEST_ASSERT_EQUAL_UINT32(500, f.last_delay_ms);

    reset_fixture();
    fsm.calibration_config.calibrated = true;
    TEST_ASSERT_EQUAL(RESQ_STATE_READY_FOR_SESSION,
                      run_state(RESQ_STATE_SESSION_INTERRUPTED));

    reset_fixture();
    fsm.calibration_config.calibrated = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_SESSION_INTERRUPTED));
}

TEST_CASE("RESETTING cleans runtime and invokes restart", "[fsm]")
{
    reset_fixture();
    f.session_active = true;
    TEST_ASSERT_EQUAL(RESQ_STATE_RESETTING, run_state(RESQ_STATE_RESETTING));
    TEST_ASSERT_EQUAL(1, f.buzzer_stop_calls);
    TEST_ASSERT_EQUAL(1, f.telemetry_stop_calls);
    TEST_ASSERT_EQUAL(1, f.session_stop_calls);
    TEST_ASSERT_EQUAL(1, f.calibration_cancel_calls);
    TEST_ASSERT_EQUAL(1, f.clear_all_calls);
    TEST_ASSERT_EQUAL(1, f.restart_calls);

    reset_fixture();
    f.clear_all_result = ESP_FAIL;
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state(RESQ_STATE_RESETTING));
    TEST_ASSERT_EQUAL(0, f.restart_calls);
}

TEST_CASE("TURN_OFF persists network and invokes soft off", "[fsm]")
{
    reset_fixture();
    fsm.calibration_config.calibrated = true;
    TEST_ASSERT_EQUAL(RESQ_STATE_TURN_OFF, run_state(RESQ_STATE_TURN_OFF));
    TEST_ASSERT_EQUAL(1, f.save_network_calls);
    TEST_ASSERT_EQUAL(1, f.soft_off_calls);
    TEST_ASSERT_EQUAL(1, f.heartbeat_stop_calls);
    TEST_ASSERT_EQUAL(1, f.mqtt_stop_calls);
    TEST_ASSERT_EQUAL(1, f.wifi_disconnect_calls);
    TEST_ASSERT_EQUAL(1, f.status_stop_calls);
}

TEST_CASE("Unknown state enters ERROR with unsupported-state reason", "[fsm]")
{
    reset_fixture();
    TEST_ASSERT_EQUAL(RESQ_STATE_ERROR, run_state((resq_state_t)99));
    TEST_ASSERT_EQUAL(FW_ERROR_UNSUPPORTED_STATE, f.last_error);
}

TEST_CASE("State entry is deduplicated and suppresses pending interruption status", "[fsm]")
{
    reset_fixture();
    int status_before = f.status_calls;
    int publish_before = f.publish_status_calls;
    resq_fsm_enter(&fsm, RESQ_STATE_BOOT);
    TEST_ASSERT_EQUAL(status_before, f.status_calls);
    TEST_ASSERT_EQUAL(publish_before, f.publish_status_calls);

    f.pending_interruption = true;
    resq_fsm_enter(&fsm, RESQ_STATE_SESSION_INTERRUPTED);
    TEST_ASSERT_EQUAL(publish_before, f.publish_status_calls);
}

TEST_CASE("Global buttons override states that do not own buttons", "[fsm]")
{
    reset_fixture();
    f.button_actions[0] = SYSTEM_BUTTON_ACTION_TURN_OFF;
    f.button_action_count = 1;
    TEST_ASSERT_EQUAL(RESQ_STATE_TURN_OFF,
                      run_state(RESQ_STATE_CONFIG_CHECK));

    reset_fixture();
    f.button_actions[0] = SYSTEM_BUTTON_ACTION_FACTORY_RESET;
    f.button_action_count = 1;
    TEST_ASSERT_EQUAL(RESQ_STATE_RESETTING,
                      run_state(RESQ_STATE_WIFI_CONNECTING));
}

TEST_CASE("Button ownership table covers all internal states", "[fsm]")
{
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_PROVISIONING));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_PAIRED_IDLE));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_READY_FOR_SESSION));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_CALIBRATING));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_CALIBRATION_FAIL));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_SESSION_ACTIVE));
    TEST_ASSERT_TRUE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_ERROR));
    TEST_ASSERT_FALSE(resq_fsm_state_handles_buttons_internally(
        RESQ_STATE_WIFI_CONNECTING));
}

TEST_CASE("USB mode suppresses readiness and sensor states", "[fsm][io_mode]")
{
    reset_fixture();
    f.sensor_mode_enabled = false;
    TEST_ASSERT_EQUAL(RESQ_STATE_CONFIG_CHECK, run_state(RESQ_STATE_BOOT));
    TEST_ASSERT_FALSE(fsm.calibration_config.calibrated);

    f.pending_interruption = true;
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_MQTT_CONNECTING));
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_CALIBRATING));
    TEST_ASSERT_EQUAL(RESQ_STATE_PAIRED_IDLE,
                      run_state(RESQ_STATE_SESSION_ACTIVE));
}
