#include "provision_ap.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/event_groups.h"

/* =========================================================
 * Temporary provisioning AP settings
 * You can change these later to match your project naming.
 * ========================================================= */
#define PROV_AP_SSID     "ResQ-Setup"
#define PROV_AP_PASS     "resq-setup-1"
#define PROV_AP_CHANNEL  1
#define PROV_AP_MAX_CONN 4

/* Provisioning completion bit */
#define PROV_DONE_BIT BIT0

static const char *TAG = "provision_ap";

static httpd_handle_t s_server = NULL;
static EventGroupHandle_t s_prov_events = NULL;
static bool s_active = false;
static device_config_t s_last_cfg;

/* Simple landing page */
static const char *index_html =
    "<html><body>"
    "<h1>ResQ Provisioning</h1>"
    "<p>This ESP is waiting for QR-based provisioning data.</p>"
    "<p>Use the Local Hub QR2 while your phone is connected to this ESP hotspot.</p>"
    "</body></html>";

/* ---------------------------------------------------------
 * Helpers
 * --------------------------------------------------------- */
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

static void url_decode_inplace(char *str)
{
    char *src = str;
    char *dst = str;

    while (*src) {
        if (*src == '+') {
            *dst++ = ' ';
        } else if (*src == '%' &&
                   isxdigit((unsigned char)src[1]) &&
                   isxdigit((unsigned char)src[2])) {
            char hex[3] = {src[1], src[2], '\0'};
            *dst++ = (char)strtol(hex, NULL, 16);
            src += 2;
        } else {
            *dst++ = *src;
        }
        src++;
    }

    *dst = '\0';
}

static void query_value_or_empty(const char *query, const char *key, char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return;
    }

    out[0] = '\0';

    if (query == NULL) {
        return;
    }

    if (httpd_query_key_value(query, key, out, out_len) == ESP_OK) {
        url_decode_inplace(out);
    } else {
        out[0] = '\0';
    }
}

static int query_int_or_default(const char *query, const char *key, int default_value)
{
    char temp[16] = {0};

    if (query == NULL) {
        return default_value;
    }

    if (httpd_query_key_value(query, key, temp, sizeof(temp)) == ESP_OK) {
        url_decode_inplace(temp);
        int value = atoi(temp);
        return (value > 0) ? value : default_value;
    }

    return default_value;
}

static bool validate_config(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return false;
    }

    /* Minimum fields required for the next step */
    if (cfg->wifi_ssid[0] == '\0') {
        ESP_LOGW(TAG, "Provisioning rejected: wifi_ssid missing");
        return false;
    }

    if (cfg->register_url[0] == '\0') {
        ESP_LOGW(TAG, "Provisioning rejected: register_url missing");
        return false;
    }

    if (cfg->auth_token[0] == '\0') {
        ESP_LOGW(TAG, "Provisioning rejected: auth_token missing");
        return false;
    }

    return true;
}

/* ---------------------------------------------------------
 * HTTP handlers
 * --------------------------------------------------------- */
static esp_err_t root_get_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_sendstr(req, index_html);
    return ESP_OK;
}

static esp_err_t provision_get_handler(httpd_req_t *req)
{
    int query_len = httpd_req_get_url_query_len(req) + 1;
    if (query_len <= 1) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"no query string provided\"}");
        return ESP_FAIL;
    }

    char *query = malloc(query_len);
    if (query == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"memory allocation failed\"}");
        return ESP_ERR_NO_MEM;
    }

    if (httpd_req_get_url_query_str(req, query, query_len) != ESP_OK) {
        free(query);
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"failed to read query string\"}");
        return ESP_FAIL;
    }

    device_config_t cfg = {0};
    cfg.mqtt_port = 1883;

    query_value_or_empty(query, "ssid",        cfg.wifi_ssid,    sizeof(cfg.wifi_ssid));
    query_value_or_empty(query, "password",    cfg.wifi_pass,    sizeof(cfg.wifi_pass));
    query_value_or_empty(query, "server_url",  cfg.register_url, sizeof(cfg.register_url));
    query_value_or_empty(query, "auth_token",  cfg.auth_token,   sizeof(cfg.auth_token));

    query_value_or_empty(query, "device_id",   cfg.device_id,    sizeof(cfg.device_id));
    query_value_or_empty(query, "manikin_id",  cfg.manikin_id,   sizeof(cfg.manikin_id));
    query_value_or_empty(query, "mqtt_host",   cfg.mqtt_host,    sizeof(cfg.mqtt_host));
    cfg.mqtt_port = query_int_or_default(query, "mqtt_port", 1883);

    free(query);

    if (!validate_config(&cfg)) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"missing required provisioning fields\"}");
        return ESP_FAIL;
    }

    cfg.provisioned = true;

    esp_err_t err = config_store_save(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "config_store_save failed: %s", esp_err_to_name(err));
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"failed to save config\"}");
        return err;
    }

    s_last_cfg = cfg;
    xEventGroupSetBits(s_prov_events, PROV_DONE_BIT);

    ESP_LOGI(TAG, "Provisioning data received and saved");
    ESP_LOGI(TAG, "  wifi_ssid   : %s", cfg.wifi_ssid);
    ESP_LOGI(TAG, "  register_url: %s", cfg.register_url);
    ESP_LOGI(TAG, "  device_id   : %s", cfg.device_id);
    ESP_LOGI(TAG, "  manikin_id  : %s", cfg.manikin_id);
    ESP_LOGI(TAG, "  mqtt_host   : %s", cfg.mqtt_host);
    ESP_LOGI(TAG, "  mqtt_port   : %d", cfg.mqtt_port);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"status\":\"ok\",\"msg\":\"provisioning saved\"}");
    return ESP_OK;
}

/* ---------------------------------------------------------
 * HTTP URI table
 * --------------------------------------------------------- */
static httpd_uri_t root_uri = {
    .uri      = "/",
    .method   = HTTP_GET,
    .handler  = root_get_handler,
    .user_ctx = NULL,
};

static httpd_uri_t provision_uri = {
    .uri      = "/provision",
    .method   = HTTP_GET,
    .handler  = provision_get_handler,
    .user_ctx = NULL,
};

static esp_err_t start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();

    esp_err_t err = httpd_start(&s_server, &config);
    if (err != ESP_OK) {
        return err;
    }

    httpd_register_uri_handler(s_server, &root_uri);
    httpd_register_uri_handler(s_server, &provision_uri);

    ESP_LOGI(TAG, "HTTP provisioning server started on port %d", config.server_port);
    return ESP_OK;
}

static void stop_webserver(void)
{
    if (s_server != NULL) {
        httpd_stop(s_server);
        s_server = NULL;
    }
}

/* ---------------------------------------------------------
 * Public API
 * --------------------------------------------------------- */
esp_err_t provisioning_start(void)
{
    if (s_active) {
        return ESP_OK;
    }

    esp_err_t err = ensure_net_stack_ready();
    if (err != ESP_OK) {
        return err;
    }

    if (s_prov_events == NULL) {
        s_prov_events = xEventGroupCreate();
        if (s_prov_events == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }
    xEventGroupClearBits(s_prov_events, PROV_DONE_BIT);

    /* Create default AP interface */
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t wifi_init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    err = esp_wifi_init(&wifi_init_cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    wifi_config_t ap_cfg = {0};

    snprintf((char *)ap_cfg.ap.ssid, sizeof(ap_cfg.ap.ssid), "%s", PROV_AP_SSID);
    snprintf((char *)ap_cfg.ap.password, sizeof(ap_cfg.ap.password), "%s", PROV_AP_PASS);

    ap_cfg.ap.ssid_len = strlen(PROV_AP_SSID);
    ap_cfg.ap.channel = PROV_AP_CHANNEL;
    ap_cfg.ap.max_connection = PROV_AP_MAX_CONN;
    ap_cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;

    err = esp_wifi_set_mode(WIFI_MODE_AP);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_set_config(WIFI_IF_AP, &ap_cfg);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_start();
    if (err != ESP_OK) {
        return err;
    }

    err = start_webserver();
    if (err != ESP_OK) {
        esp_wifi_stop();
        return err;
    }

    s_active = true;

    ESP_LOGI(TAG, "Provisioning AP started");
    ESP_LOGI(TAG, "  AP SSID    : %s", PROV_AP_SSID);
    ESP_LOGI(TAG, "  AP Password: %s", PROV_AP_PASS);
    ESP_LOGI(TAG, "  AP IP      : 192.168.4.1");

    return ESP_OK;
}

esp_err_t provisioning_stop(void)
{
    stop_webserver();

    esp_wifi_stop();
    esp_wifi_deinit();

    s_active = false;
    ESP_LOGI(TAG, "Provisioning AP stopped");
    return ESP_OK;
}

esp_err_t provisioning_wait_for_config(device_config_t *out_cfg, TickType_t timeout_ticks)
{
    if (out_cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_prov_events == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    EventBits_t bits = xEventGroupWaitBits(
        s_prov_events,
        PROV_DONE_BIT,
        pdTRUE,     /* clear on exit */
        pdFALSE,
        timeout_ticks
    );

    if ((bits & PROV_DONE_BIT) == 0) {
        return ESP_ERR_TIMEOUT;
    }

    *out_cfg = s_last_cfg;
    return ESP_OK;
}

bool provisioning_is_active(void)
{
    return s_active;
}