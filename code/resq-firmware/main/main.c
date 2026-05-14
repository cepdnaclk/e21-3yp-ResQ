#include <stdbool.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "backend_register_client.h"
#include "config_store.h"
#include "mqtt_manager.h"
#include "provisioning_manager.h"
#include "resq_config_types.h"
#include "status_indicator.h"
#include "states.h"
#include "wifi_manager.h"

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

static volatile resq_state_t g_current_state = RESQ_STATE_BOOT;
static bool g_has_entered_state = false;

static bool g_components_initialized = false;

static bool g_session_active = false;
static bool g_sensor_running = false;

static char g_session_id[64] = {0};
static char g_ip[16] = {0};

static TaskHandle_t g_heartbeat_task_handle = NULL;

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
             "BOOT loaded config: provisioned=%s calibrated=%s device_mac=%s device_id=%s",
             g_network_cfg.provisioned ? "true" : "false",
             g_calibration_cfg.calibrated ? "true" : "false",
             g_network_cfg.device_mac,
             g_network_cfg.device_id);

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
             "Provisioning complete. SSID=%s MQTT=%s:%ld register_url=%s",
             g_network_cfg.wifi_ssid,
             g_network_cfg.mqtt_host,
             (long)g_network_cfg.mqtt_port,
             g_network_cfg.register_url);

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

        return RESQ_STATE_FLUSH_CONFIG;
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
    esp_err_t err = backend_register_client_register(&g_network_cfg);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Backend registration failed: %s",
                 esp_err_to_name(err));

        return RESQ_STATE_ERROR;
    }

    if (g_network_cfg.device_id[0] == '\0') {
        ESP_LOGE(TAG, "Backend registration succeeded but device_id is empty");
        return RESQ_STATE_ERROR;
    }

    err = config_store_save_network(&g_network_cfg);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to save backend-updated config: %s",
                 esp_err_to_name(err));

        return RESQ_STATE_ERROR;
    }

    ESP_LOGI(TAG,
             "Backend registration complete. device_id=%s mqtt=%s:%ld",
             g_network_cfg.device_id,
             g_network_cfg.mqtt_host,
             (long)g_network_cfg.mqtt_port);

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
    esp_err_t err = mqtt_manager_start(&g_network_cfg);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "MQTT connection failed: %s",
                 esp_err_to_name(err));

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

    /*
     * First heartbeat immediately after MQTT connection.
     */
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
    /*
     * Future:
     * - wait for cmd/calibration/start
     * - wait for cmd/device/reset
     * - wait for cmd/device/unpair
     */
    vTaskDelay(pdMS_TO_TICKS(IDLE_LOOP_DELAY_MS));
    return RESQ_STATE_PAIRED_IDLE;
}

static resq_state_t run_ready_for_session_state(void)
{
    /*
     * Future:
     * - wait for cmd/session/start
     * - allow session only if calibrated == true
     */
    vTaskDelay(pdMS_TO_TICKS(IDLE_LOOP_DELAY_MS));
    return RESQ_STATE_READY_FOR_SESSION;
}

static resq_state_t run_error_state(void)
{
    /*
     * Future:
     * - support reset command
     * - support watchdog/recovery
     */
    vTaskDelay(pdMS_TO_TICKS(IDLE_LOOP_DELAY_MS));
    return RESQ_STATE_ERROR;
}

/* =========================================================
 * Main entry point
 * ========================================================= */

void app_main(void)
{
    /*
     * Start status indicator first so BOOT/ERROR can be shown visually.
     */
    ESP_ERROR_CHECK(status_indicator_init());
    ESP_ERROR_CHECK(status_indicator_start());

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

        case RESQ_STATE_READY_FOR_SESSION:
            next_state = run_ready_for_session_state();
            break;

        case RESQ_STATE_ERROR:
        default:
            next_state = run_error_state();
            break;
        }

        if (next_state != g_current_state) {
            enter_state(next_state);
        }

        vTaskDelay(pdMS_TO_TICKS(MAIN_LOOP_DELAY_MS));
    }
}