#include <stdbool.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"

#include "esp_event.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "nvs_flash.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "backend_register_client.h"
#include "config_store.h"
#include "mqtt_manager.h"
#include "provisioning_manager.h"
#include "resq_config_types.h"
#include "status_indicator.h"
#include "error_manager.h"
#include "states.h"
#include "wifi_manager.h"
#include "runtime_helpers.h"
#include "paired_idle_manager.h"
#include "calibration_state_manager.h"
#include "calibration_manager.h"
#include "calibration_fail_manager.h"
#include "session_manager.h"
#include "cpr_metrics.h"
#include "buzzer_manager.h"
#include "telemetry_publisher.h"
#include "session_active_manager.h"

/* =========================================================
 * Main firmware configuration
 * ========================================================= */

#define MAIN_LOOP_DELAY_MS              100
#define IDLE_LOOP_DELAY_MS              1000

#define HEARTBEAT_INTERVAL_MS           5000
#define HEARTBEAT_TASK_STACK_SIZE       3072
#define HEARTBEAT_TASK_PRIORITY         3

/* =========================================================
 * Private runtime state
 * ========================================================= */

static const char *TAG = "resq_main";

static network_config_t g_network_cfg;
static calibration_config_t g_calibration_cfg;

static backend_registration_result_t s_backend_result;

static volatile resq_state_t g_current_state = RESQ_STATE_BOOT;
static bool g_has_entered_state = false;

static bool g_components_initialized = false;

static bool g_session_active = false;
static bool g_sensor_running = false;

static char g_session_id[64] = {0};
static char g_ip[16] = {0};

static TaskHandle_t g_heartbeat_task_handle = NULL;

/* Forward declarations for state handlers used by app_main() */
static esp_err_t initialize_components_once(void);
static resq_state_t run_boot_state(void);
static resq_state_t run_config_check_state(void);
static resq_state_t run_provisioning_state(void);
static resq_state_t run_flush_config_state(void);
static resq_state_t run_wifi_connecting_state(void);
static resq_state_t run_backend_registering_state(void);
static resq_state_t run_mqtt_connecting_state(void);
static resq_state_t run_paired_idle_state(void);
static resq_state_t run_ready_for_session_state(void);
static resq_state_t run_calibration_fail_state(void);
static resq_state_t run_error_state(void);
static resq_state_t run_session_interrupted_state(void);

/* =========================================================
 * Small helpers
 * ========================================================= */

static void runtime_clear_session_values(void)
{
    g_session_active = false;
    g_sensor_running = false;
    g_session_id[0] = '\0';
}

/**
 * @brief Publish status only if MQTT is already connected.
 *
 * Before MQTT connects, this safely does nothing.
 */
static void publish_status_if_connected(resq_state_t state)
{
    if (!mqtt_manager_is_connected()) {
        return;
    }

    esp_err_t err = mqtt_manager_publish_status(
        state,
        &g_network_cfg,
        &g_calibration_cfg,
        g_session_active,
        g_session_id,
        g_ip
    );

    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to publish status for state %s: %s",
                 resq_state_to_string(state),
                 esp_err_to_name(err));
    }
}

/**
 * @brief Enter a state only once when it changes.
 *
 * This prevents repeated LED/log/status spam while staying in
 * PAIRED_IDLE or READY_FOR_SESSION.
 */
static void enter_state(resq_state_t state)
{
    if (g_has_entered_state && g_current_state == state) {
        return;
    }

    g_current_state = state;
    g_has_entered_state = true;

    ESP_LOGI(TAG, "Entering state: %s", resq_state_to_string(state));

    status_indicator_set_state(state);

    publish_status_if_connected(state);
}

/**
 * @brief Initialize all already-developed managers once.
 *
 * Status indicator is initialized in app_main before this so BOOT LED
 * can be shown even if another component fails.
 */
static esp_err_t initialize_components_once(void)
{
    if (g_components_initialized) {
        return ESP_OK;
    }

    esp_err_t err;

    err = config_store_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "config_store_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = provisioning_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "provisioning_manager_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = wifi_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "wifi_manager_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = backend_register_client_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "backend_register_client_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = mqtt_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "mqtt_manager_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    /* Initialize managers that run during PAIRED_IDLE / calibration */
    err = paired_idle_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "paired_idle_manager_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = calibration_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "calibration_manager_init failed: %s",
                 esp_err_to_name(err));
        return err;
    }

    err = calibration_fail_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "calibration_fail_manager_init failed: %s", esp_err_to_name(err));
        return err;
    }

    /* Initialize new session-related managers */
    err = session_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "session_manager_init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = cpr_metrics_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "cpr_metrics_init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = buzzer_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "buzzer_manager_init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = telemetry_publisher_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "telemetry_publisher_init failed: %s", esp_err_to_name(err));
        return err;
    }

    err = session_active_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "session_active_manager_init failed: %s", esp_err_to_name(err));
        return err;
    }

    g_components_initialized = true;

    ESP_LOGI(TAG, "Core firmware components initialized");

    return ESP_OK;
}

/* =========================================================
 * Heartbeat task
 * ========================================================= */

static void heartbeat_task(void *arg)
{
    (void)arg;

    while (true) {
        if (mqtt_manager_is_connected()) {
            char latest_ip[sizeof(g_ip)] = {0};

            if (wifi_manager_get_ip(latest_ip, sizeof(latest_ip)) == ESP_OK) {
                strncpy(g_ip, latest_ip, sizeof(g_ip) - 1);
                g_ip[sizeof(g_ip) - 1] = '\0';
            }

            esp_err_t err = mqtt_manager_publish_heartbeat(
                &g_network_cfg,
                &g_calibration_cfg,
                g_current_state,
                g_session_active,
                g_sensor_running,
                g_session_id,
                g_ip,
                wifi_manager_get_rssi()
            );

            if (err != ESP_OK) {
                ESP_LOGW(TAG,
                         "Heartbeat publish failed: %s",
                         esp_err_to_name(err));
            }
        }

        vTaskDelay(pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS));
    }
}

static esp_err_t start_heartbeat_task_once(void)
{
    if (g_heartbeat_task_handle != NULL) {
        return ESP_OK;
    }

    BaseType_t result = xTaskCreate(
        heartbeat_task,
        "heartbeat_task",
        HEARTBEAT_TASK_STACK_SIZE,
        NULL,
        HEARTBEAT_TASK_PRIORITY,
        &g_heartbeat_task_handle
    );

    if (result != pdPASS) {
        g_heartbeat_task_handle = NULL;
        return ESP_FAIL;
    }

    return ESP_OK;
}

/* =========================================================
 * State handlers
 * ========================================================= */

/**
 * BOOT:
 * - initialize components
 * - load network config from NVS
 * - load calibration config from NVS
 * - reset runtime session values
 * - move to CONFIG_CHECK
 */
static resq_state_t run_boot_state(void)
{
    esp_err_t err = initialize_components_once();
    if (err != ESP_OK) {
        error_manager_set_error(FW_ERROR_NVS_INIT_FAILED);
        return RESQ_STATE_ERROR;
    }

    network_config_set_defaults(&g_network_cfg);
    calibration_config_set_defaults(&g_calibration_cfg);

    err = config_store_load_network(&g_network_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to load network config: %s",
                 esp_err_to_name(err));
        return RESQ_STATE_ERROR;
    }

    err = config_store_load_calibration(&g_calibration_cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to load calibration config: %s",
                 esp_err_to_name(err));

        calibration_config_set_defaults(&g_calibration_cfg);
    }

    /*
     * Calibration invalid does not block network connection.
     * It only decides READY_FOR_SESSION vs PAIRED_IDLE later.
     */
    calibration_config_validate(&g_calibration_cfg);

    runtime_clear_session_values();

    ESP_LOGI(TAG,
             "BOOT loaded config: provisioned=%s calibrated=%s backend_base_url=%s",
             g_network_cfg.provisioned ? "true" : "false",
             g_calibration_cfg.calibrated ? "true" : "false",
             g_network_cfg.backend_base_url);

    return RESQ_STATE_CONFIG_CHECK;
}

/**
 * CONFIG_CHECK:
 * - validate network_config_t
 * - if valid, go to WIFI_CONNECTING
 * - if invalid, go to PROVISIONING
 */
static resq_state_t run_config_check_state(void)
{
    bool network_ok = network_config_validate(&g_network_cfg);

    if (!network_ok) {
        ESP_LOGW(TAG, "Network config invalid. Entering provisioning.");
        return RESQ_STATE_PROVISIONING;
    }

    ESP_LOGI(TAG, "Network config valid. Connecting to Wi-Fi.");

    return RESQ_STATE_WIFI_CONNECTING;
}

/**
 * PROVISIONING:
 * - start SoftAP + HTTP portal
 * - wait until /provision + /provision/ack completes
 * - stop provisioning portal
 * - reload network config
 * - move to WIFI_CONNECTING
 */
static resq_state_t run_provisioning_state(void)
{
    esp_err_t err = provisioning_manager_start();

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Provisioning start failed: %s",
                 esp_err_to_name(err));

        return RESQ_STATE_ERROR;
    }

    ESP_LOGI(TAG,
             "Provisioning portal active. Connect to ESP AP and open http://192.168.4.1/");

    while (!provisioning_manager_has_saved_config()) {
        vTaskDelay(pdMS_TO_TICKS(200));
    }

    /*
     * Stop SoftAP and HTTP server only after confirmed ACK flow completed.
     */
    err = provisioning_manager_stop();

    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Provisioning stop returned: %s",
                 esp_err_to_name(err));
    }

    /*
     * Reload from NVS so runtime config matches what was saved.
     */
    network_config_set_defaults(&g_network_cfg);

    err = config_store_load_network(&g_network_cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to reload network config after provisioning: %s",
                 esp_err_to_name(err));

        return RESQ_STATE_ERROR;
    }

    if (!network_config_validate(&g_network_cfg)) {
        ESP_LOGE(TAG, "Saved network config is invalid after provisioning");
        return RESQ_STATE_PROVISIONING;
    }

    ESP_LOGI(TAG,
             "Provisioning complete. SSID=%s backend_base_url=%s",
             g_network_cfg.wifi_ssid,
             g_network_cfg.backend_base_url);

    return RESQ_STATE_WIFI_CONNECTING;
}

/**
 * FLUSH_CONFIG:
 * - clear saved network config
 * - keep hardware MAC
 * - return to provisioning
 */
static resq_state_t run_flush_config_state(void)
{
    ESP_LOGW(TAG, "Flushing network configuration");

    mqtt_manager_stop();
    wifi_manager_disconnect();
    provisioning_manager_stop();

    esp_err_t err = config_store_clear_network();

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to clear network config: %s",
                 esp_err_to_name(err));

        return RESQ_STATE_ERROR;
    }

    network_config_set_defaults(&g_network_cfg);

    return RESQ_STATE_PROVISIONING;
}

/**
 * WIFI_CONNECTING:
 * - connect to saved Wi-Fi
 * - get IP
 * - move to BACKEND_REGISTERING
 */
static resq_state_t run_wifi_connecting_state(void)
{
    if (!network_config_validate(&g_network_cfg)) {
        ESP_LOGE(TAG, "Network config invalid before Wi-Fi connect");
        return RESQ_STATE_FLUSH_CONFIG;
    }

    esp_err_t err = wifi_manager_connect(
        g_network_cfg.wifi_ssid,
        g_network_cfg.wifi_pass,
        WIFI_MANAGER_DEFAULT_MAX_RETRIES,
        WIFI_MANAGER_DEFAULT_TIMEOUT_MS
    );

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Wi-Fi connection failed: %s",
                 esp_err_to_name(err));

        error_manager_set_error(FW_ERROR_WIFI_CONNECT_FAILED);
        return RESQ_STATE_ERROR;
    }

    err = wifi_manager_get_ip(g_ip, sizeof(g_ip));

    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Wi-Fi connected but IP read failed: %s",
                 esp_err_to_name(err));

        g_ip[0] = '\0';
    }

    ESP_LOGI(TAG, "Wi-Fi connected. IP=%s", g_ip);

    return RESQ_STATE_BACKEND_REGISTERING;
}

/**
 * BACKEND_REGISTERING:
 * - send device_mac and optional existing device_id to backend
 * - backend must return device_id
 * - save updated network config
 * - move to MQTT_CONNECTING
 */
static resq_state_t run_backend_registering_state(void)
{
    backend_registration_result_t result = {0};

    esp_err_t err = backend_register_client_register(&g_network_cfg, &result);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Backend registration failed: %s",
                 esp_err_to_name(err));
        error_manager_set_error(FW_ERROR_BACKEND_REGISTER_FAILED);
        return RESQ_STATE_ERROR;
    }

    if (result.device_id[0] == '\0') {
        ESP_LOGE(TAG, "Backend registration succeeded but device_id is empty");
        error_manager_set_error(FW_ERROR_BACKEND_INVALID_RESPONSE);
        return RESQ_STATE_ERROR;
    }

    /* Keep backend/device identifiers in RAM only — do not persist them. */
    memcpy(&s_backend_result, &result, sizeof(s_backend_result));

    ESP_LOGI(TAG,
             "Backend registration complete. device_id=%s mqtt=%s:%d",
             s_backend_result.device_id,
             s_backend_result.mqtt_host,
             (int)s_backend_result.mqtt_port);

    return RESQ_STATE_MQTT_CONNECTING;
}

/**
 * MQTT_CONNECTING:
 * - connect to broker
 * - subscribe to resq/{deviceId}/cmd/#
 * - publish identity event
 * - start heartbeat
 * - go to READY_FOR_SESSION if calibrated, else PAIRED_IDLE
 */
static resq_state_t run_mqtt_connecting_state(void)
{
    ESP_LOGI(TAG, "Entering MQTT_CONNECTING state");
    status_indicator_set_state(RESQ_STATE_MQTT_CONNECTING);

    esp_err_t err = mqtt_manager_start(s_backend_result.device_id,
                                       s_backend_result.mqtt_host,
                                       s_backend_result.mqtt_port);
    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "MQTT start failed: %s",
                 esp_err_to_name(err));
        error_manager_set_error(FW_ERROR_MQTT_CONNECT_FAILED);
        return RESQ_STATE_ERROR;
    }

    err = mqtt_manager_publish_identity_event(&g_network_cfg);
    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to publish identity event: %s",
                 esp_err_to_name(err));
    }

    calibration_config_validate(&g_calibration_cfg);

    resq_state_t next_state = g_calibration_cfg.calibrated
        ? RESQ_STATE_READY_FOR_SESSION
        : RESQ_STATE_PAIRED_IDLE;

    err = start_heartbeat_task_once();
    if (err != ESP_OK) {
        ESP_LOGW(TAG,
                 "Failed to start heartbeat task: %s",
                 esp_err_to_name(err));
    }

    /* First heartbeat immediately after MQTT connection. */
    mqtt_manager_publish_heartbeat(
        &g_network_cfg,
        &g_calibration_cfg,
        next_state,
        g_session_active,
        g_sensor_running,
        g_session_id,
        g_ip,
        wifi_manager_get_rssi()
    );

    ESP_LOGI(TAG,
             "MQTT connected. Next state=%s",
             resq_state_to_string(next_state));

    return next_state;
}

static resq_state_t run_paired_idle_state(void)
{
    ESP_LOGI(TAG, "Entering PAIRED_IDLE state");

    status_indicator_set_state(RESQ_STATE_PAIRED_IDLE);

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_PAIRED_IDLE,
                                    &g_network_cfg,
                                    &g_calibration_cfg,
                                    false,
                                    "",
                                    g_ip);
    }

    return paired_idle_manager_run(&g_network_cfg,
                                   &g_calibration_cfg,
                                   g_ip);
}

static resq_state_t run_calibration_fail_state(void)
{
    return calibration_fail_manager_run(&g_network_cfg,
                                        &g_calibration_cfg,
                                        g_ip);
}

static resq_state_t run_ready_for_session_state(void)
{
    ESP_LOGI(TAG, "Entering READY_FOR_SESSION state");

    status_indicator_set_state(RESQ_STATE_READY_FOR_SESSION);

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_READY_FOR_SESSION,
                                    &g_network_cfg,
                                    &g_calibration_cfg,
                                    false,
                                    "",
                                    g_ip);
    }

    /*
     * SESSION_ACTIVE is not fully implemented in this folder yet.
     * Reuse the idle command wait loop, but it will show READY_FOR_SESSION
     * when calibration_config.calibrated is true.
     */
    return paired_idle_manager_run(&g_network_cfg,
                                   &g_calibration_cfg,
                                   g_ip);
}

static resq_state_t run_session_interrupted_state(void)
{
    status_indicator_set_state(RESQ_STATE_SESSION_INTERRUPTED);

    if (mqtt_manager_is_connected()) {
        mqtt_manager_publish_status(RESQ_STATE_SESSION_INTERRUPTED,
                                    &g_network_cfg,
                                    &g_calibration_cfg,
                                    false,
                                    "",
                                    g_ip);
    }

    vTaskDelay(pdMS_TO_TICKS(500));

    if (g_calibration_cfg.calibrated) {
        return RESQ_STATE_READY_FOR_SESSION;
    }

    return RESQ_STATE_PAIRED_IDLE;
}

static resq_state_t run_error_state(void)
{
    return error_manager_run(&g_network_cfg,
                             &g_calibration_cfg,
                             g_ip);
}

/* =========================================================
 * Main entry point
 * ========================================================= */

void app_main(void)
{
    /*
     * Initialize ESP-IDF base subsystems used by components.
     */
    esp_err_t err = esp_netif_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "esp_netif_init failed: %s", esp_err_to_name(err));
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG, "esp_event_loop_create_default: %s", esp_err_to_name(err));
    }

    /* Start status indicator so BOOT/ERROR are visible immediately. */
    ESP_ERROR_CHECK(status_indicator_init());
    ESP_ERROR_CHECK(status_indicator_start());

    /* Initialize error manager (button) early so ERROR state can use it. */
    err = error_manager_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "error_manager_init failed: %s", esp_err_to_name(err));
    }

    enter_state(RESQ_STATE_BOOT);

    while (true) {
        resq_state_t next_state = g_current_state;

        switch (g_current_state)
        {
        case RESQ_STATE_BOOT:
            next_state = run_boot_state();
            break;

        case RESQ_STATE_CONFIG_CHECK:
            next_state = run_config_check_state();
            break;

        case RESQ_STATE_PROVISIONING:
            next_state = run_provisioning_state();
            break;

        case RESQ_STATE_FLUSH_CONFIG:
            next_state = run_flush_config_state();
            break;

        case RESQ_STATE_WIFI_CONNECTING:
            next_state = run_wifi_connecting_state();
            break;

        case RESQ_STATE_BACKEND_REGISTERING:
            next_state = run_backend_registering_state();
            break;

        case RESQ_STATE_MQTT_CONNECTING:
            next_state = run_mqtt_connecting_state();
            break;

        case RESQ_STATE_PAIRED_IDLE:
            next_state = run_paired_idle_state();
            break;

        case RESQ_STATE_CALIBRATING:
            next_state = calibration_state_manager_run(&g_network_cfg,
                                                      &g_calibration_cfg,
                                                      g_ip);
            break;

        case RESQ_STATE_SESSION_ACTIVE:
            next_state = session_active_manager_run(&g_network_cfg,
                                                    &g_calibration_cfg,
                                                    g_ip);
            break;

        case RESQ_STATE_SESSION_INTERRUPTED:
            next_state = run_session_interrupted_state();
            break;

        case RESQ_STATE_CALIBRATION_FAIL:
            next_state = run_calibration_fail_state();
            break;

        case RESQ_STATE_READY_FOR_SESSION:
            next_state = run_ready_for_session_state();
            break;

        case RESQ_STATE_ERROR:
            next_state = run_error_state();
            break;

        default:
            error_manager_set_error(FW_ERROR_UNSUPPORTED_STATE);
            next_state = RESQ_STATE_ERROR;
            break;
        }

        if (next_state != g_current_state) {
            enter_state(next_state);
        }

        vTaskDelay(pdMS_TO_TICKS(MAIN_LOOP_DELAY_MS));
    }
}