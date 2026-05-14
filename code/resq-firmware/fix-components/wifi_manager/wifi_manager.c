#include "wifi_manager.h"

#include <string.h>
#include <stdio.h>
#include <limits.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/event_groups.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "wifi_manager";

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t s_wifi_events = NULL;
static esp_netif_t *s_sta_netif = NULL;

static bool s_initialized = false;
static bool s_connected = false;
static int s_retry_count = 0;
static int s_max_retries = WIFI_MANAGER_DEFAULT_MAX_RETRIES;
static char s_ip_addr[16] = {0};

static esp_event_handler_instance_t s_any_wifi_handler;
static esp_event_handler_instance_t s_got_ip_handler;

static esp_err_t ensure_net_stack_ready(void)
{
    esp_err_t err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    return ESP_OK;
}

static void wifi_event_handler(void *arg,
                               esp_event_base_t event_base,
                               int32_t event_id,
                               void *event_data)
{
    (void)arg;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "Wi-Fi STA started");
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_connected = false;

        if (s_retry_count < s_max_retries) {
            s_retry_count++;
            ESP_LOGW(TAG, "Wi-Fi disconnected, retry %d/%d", s_retry_count, s_max_retries);
            esp_wifi_connect();
        } else {
            ESP_LOGE(TAG, "Wi-Fi failed after max retries");
            xEventGroupSetBits(s_wifi_events, WIFI_FAIL_BIT);
        }

        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;

        s_retry_count = 0;
        s_connected = true;

        snprintf(s_ip_addr, sizeof(s_ip_addr), IPSTR, IP2STR(&event->ip_info.ip));

        ESP_LOGI(TAG, "Got IP: %s", s_ip_addr);

        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
        return;
    }
}

esp_err_t wifi_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    esp_err_t err = ensure_net_stack_ready();
    if (err != ESP_OK) {
        return err;
    }

    if (s_wifi_events == NULL) {
        s_wifi_events = xEventGroupCreate();
        if (s_wifi_events == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    s_sta_netif = esp_netif_create_default_wifi_sta();

    wifi_init_config_t wifi_init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    err = esp_wifi_init(&wifi_init_cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    err = esp_event_handler_instance_register(
        WIFI_EVENT,
        ESP_EVENT_ANY_ID,
        &wifi_event_handler,
        NULL,
        &s_any_wifi_handler
    );
    if (err != ESP_OK) {
        return err;
    }

    err = esp_event_handler_instance_register(
        IP_EVENT,
        IP_EVENT_STA_GOT_IP,
        &wifi_event_handler,
        NULL,
        &s_got_ip_handler
    );
    if (err != ESP_OK) {
        return err;
    }

    s_initialized = true;
    ESP_LOGI(TAG, "Wi-Fi manager initialized");
    return ESP_OK;
}

esp_err_t wifi_manager_connect(const char *ssid,
                               const char *password,
                               int max_retries,
                               int timeout_ms)
{
    if (ssid == NULL || ssid[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = wifi_manager_init();
    if (err != ESP_OK) {
        return err;
    }

    if (max_retries <= 0) {
        s_max_retries = WIFI_MANAGER_DEFAULT_MAX_RETRIES;
    } else {
        s_max_retries = max_retries;
    }

    if (timeout_ms <= 0) {
        timeout_ms = WIFI_MANAGER_DEFAULT_TIMEOUT_MS;
    }

    xEventGroupClearBits(s_wifi_events, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);
    s_retry_count = 0;
    s_connected = false;
    s_ip_addr[0] = '\0';

    wifi_config_t wifi_cfg = {0};
    snprintf((char *)wifi_cfg.sta.ssid, sizeof(wifi_cfg.sta.ssid), "%s", ssid);

    if (password != NULL && password[0] != '\0') {
        snprintf((char *)wifi_cfg.sta.password, sizeof(wifi_cfg.sta.password), "%s", password);
    }

    err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_start();
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_connect();
    if (err != ESP_OK) {
        return err;
    }

    ESP_LOGI(TAG, "Connecting to Wi-Fi SSID: %s", ssid);

    EventBits_t bits = xEventGroupWaitBits(
        s_wifi_events,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
        pdFALSE,
        pdFALSE,
        pdMS_TO_TICKS(timeout_ms)
    );

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Wi-Fi connected successfully");
        return ESP_OK;
    }

    if (bits & WIFI_FAIL_BIT) {
        ESP_LOGE(TAG, "Wi-Fi connection failed");
        return ESP_FAIL;
    }

    ESP_LOGE(TAG, "Wi-Fi connection timeout");
    return ESP_ERR_TIMEOUT;
}

esp_err_t wifi_manager_disconnect(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    s_connected = false;
    return esp_wifi_disconnect();
}

bool wifi_manager_is_connected(void)
{
    return s_connected;
}

esp_err_t wifi_manager_get_ip(char *buffer, size_t buffer_len)
{
    if (buffer == NULL || buffer_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_ip_addr[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    snprintf(buffer, buffer_len, "%s", s_ip_addr);
    return ESP_OK;
}

int wifi_manager_get_rssi(void)
{
    wifi_ap_record_t ap_info;
    if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
        return ap_info.rssi;
    }

    return INT_MIN;
}
