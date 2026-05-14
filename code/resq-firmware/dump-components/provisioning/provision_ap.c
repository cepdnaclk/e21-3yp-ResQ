#include "provision_ap.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
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
    "<!doctype html><html><head>"
    "<meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>ResQ Provisioning</title>"
    "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px;line-height:1.45}"
    "code{background:#f1f5f9;padding:2px 6px;border-radius:6px}"
    "#s{font-weight:600}</style>"
    "</head><body>"
    "<h1>ResQ Provisioning</h1>"
    "<p id='s'>Ready. Waiting for QR payload.</p>"
    "<p>Keep this phone on <code>ResQ-Setup</code> Wi-Fi.</p>"
    "<script>"
    "(function(){"
    "const el=document.getElementById('s');"
    "const hash=(location.hash||'').replace(/^#/, '');"
    "const p=new URLSearchParams(hash).get('p');"
    "if(!p){el.textContent='No QR payload found. Scan QR2 again.';return;}"
    "function b64uToText(v){"
    "const b=v.replace(/-/g,'+').replace(/_/g,'/');"
    "const pad='='.repeat((4-(b.length%4))%4);"
    "const raw=atob(b+pad);"
    "const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));"
    "return new TextDecoder().decode(bytes);"
    "}"
    "let body='';"
    "try{body=b64uToText(p);JSON.parse(body);}"
    "catch(e){el.textContent='Invalid QR payload.';return;}"
    "el.textContent='Sending provisioning request...';"
    "fetch('/provision',{method:'POST',headers:{'Content-Type':'application/json'},body:body})"
    ".then(async r=>{"
    "if(!r.ok){throw new Error('HTTP '+r.status);}"
    "el.textContent='Provision sent successfully. You can close this page.';"
    "})"
    ".catch(e=>{el.textContent='Provision failed: '+(e&&e.message?e.message:String(e));});"
    "})();"
    "</script>"
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

static esp_err_t read_request_body(httpd_req_t *req, char *buf, size_t buf_len)
{
    if (req == NULL || buf == NULL || buf_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int total_len = req->content_len;
    if (total_len <= 0 || total_len >= (int)buf_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    int received = 0;
    while (received < total_len) {
        int r = httpd_req_recv(req, buf + received, total_len - received);
        if (r <= 0) {
            return ESP_FAIL;
        }
        received += r;
    }

    buf[received] = '\0';
    return ESP_OK;
}

/* Apply/save provisioning config and signal completion (shared helper) */
static esp_err_t apply_provisioning_config(const device_config_t *cfg)
{
    if (cfg == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = config_store_save(cfg);
    if (err != ESP_OK) {
        return err;
    }

    s_last_cfg = *cfg;
    xEventGroupSetBits(s_prov_events, PROV_DONE_BIT);

    /* Safe logging only (never log password or auth token) */
    ESP_LOGI(TAG, "Provisioning data received and saved");
    ESP_LOGI(TAG, "  wifi_ssid   : %s", cfg->wifi_ssid);
    ESP_LOGI(TAG, "  register_url: %s", cfg->register_url);
    ESP_LOGI(TAG, "  device_id   : %s", cfg->device_id);
    ESP_LOGI(TAG, "  mqtt_host   : %s", cfg->mqtt_host);
    ESP_LOGI(TAG, "  mqtt_port   : %d", cfg->mqtt_port);

    return ESP_OK;
}

static void safe_copy(char *dst, size_t dst_len, const char *src)
{
    if (dst == NULL || dst_len == 0) return;
    if (src == NULL) {
        dst[0] = '\0';
        return;
    }
    strncpy(dst, src, dst_len - 1);
    dst[dst_len - 1] = '\0';
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

static esp_err_t provision_post_handler(httpd_req_t *req)
{
    char body[768] = {0};
    esp_err_t err = read_request_body(req, body, sizeof(body));
    if (err != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"invalid request body\"}");
        return err;
    }

    cJSON *root = cJSON_Parse(body);
    if (!root) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"invalid JSON\"}");
        return ESP_ERR_INVALID_ARG;
    }

    device_config_t cfg;
    esp_err_t load_err = config_store_load(&cfg);
    if (load_err != ESP_OK) {
        memset(&cfg, 0, sizeof(cfg));
        cfg.mqtt_port = 1883;
        cfg.hall_baseline = 3420;
        cfg.hall_min_delta = 520;
        cfg.hall_max_delta = 1060;
        cfg.compression_start_delta = 200;
        cfg.sensor_sample_interval_ms = 20;
    }

    cJSON *ssid = cJSON_GetObjectItemCaseSensitive(root, "ssid");
    cJSON *password = cJSON_GetObjectItemCaseSensitive(root, "password");
    cJSON *server_url = cJSON_GetObjectItemCaseSensitive(root, "server_url");
    cJSON *auth_token = cJSON_GetObjectItemCaseSensitive(root, "auth_token");
    cJSON *device_id = cJSON_GetObjectItemCaseSensitive(root, "device_id");
    cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(root, "mqtt_host");
    cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(root, "mqtt_port");

    if (!cJSON_IsString(ssid) || !ssid->valuestring || ssid->valuestring[0] == '\0' ||
        !cJSON_IsString(server_url) || !server_url->valuestring || server_url->valuestring[0] == '\0' ||
        !cJSON_IsString(auth_token) || !auth_token->valuestring || auth_token->valuestring[0] == '\0') {
        cJSON_Delete(root);
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"missing required fields\"}");
        return ESP_ERR_INVALID_ARG;
    }

    snprintf(cfg.wifi_ssid, sizeof(cfg.wifi_ssid), "%s", ssid->valuestring);

    if (cJSON_IsString(password) && password->valuestring) {
        snprintf(cfg.wifi_pass, sizeof(cfg.wifi_pass), "%s", password->valuestring);
    } else {
        cfg.wifi_pass[0] = '\0';
    }

    snprintf(cfg.register_url, sizeof(cfg.register_url), "%s", server_url->valuestring);
    snprintf(cfg.auth_token, sizeof(cfg.auth_token), "%s", auth_token->valuestring);

    if (cJSON_IsString(device_id) && device_id->valuestring) {
        snprintf(cfg.device_id, sizeof(cfg.device_id), "%s", device_id->valuestring);
    }

    /* Ignore manikin_id if present in provisioning payload; firmware now uses device_id only */

    if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring) {
        snprintf(cfg.mqtt_host, sizeof(cfg.mqtt_host), "%s", mqtt_host->valuestring);
    }

    if (cJSON_IsNumber(mqtt_port) && mqtt_port->valueint > 0) {
        cfg.mqtt_port = mqtt_port->valueint;
    }

    cfg.provisioned = true;

    cJSON_Delete(root);

    err = apply_provisioning_config(&cfg);
    if (err != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_sendstr(req, "{\"status\":\"error\",\"msg\":\"failed to save config\"}");
        return err;
    }

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"status\":\"ok\",\"msg\":\"provisioning saved\"}");
    return ESP_OK;
}

static esp_err_t provision_get_handler(httpd_req_t *req)
{
    char query[512] = {0};
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request");
        httpd_resp_set_type(req, "text/plain");
        httpd_resp_sendstr(req, "Missing or invalid provisioning fields");
        return ESP_FAIL;
    }

    device_config_t cfg;
    esp_err_t load_err = config_store_load(&cfg);
    if (load_err != ESP_OK) {
        memset(&cfg, 0, sizeof(cfg));
        cfg.mqtt_port = 1883;
        cfg.hall_baseline = 3420;
        cfg.hall_min_delta = 520;
        cfg.hall_max_delta = 1060;
        cfg.compression_start_delta = 200;
        cfg.sensor_sample_interval_ms = 20;
    }

    char temp[512] = {0};

    /* Required keys: ssid, password, server_url, auth_token, device_id, mqtt_host, mqtt_port */
    if (httpd_query_key_value(query, "ssid", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.wifi_ssid)) goto bad_req;
    safe_copy(cfg.wifi_ssid, sizeof(cfg.wifi_ssid), temp);

    if (httpd_query_key_value(query, "password", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.wifi_pass)) goto bad_req;
    safe_copy(cfg.wifi_pass, sizeof(cfg.wifi_pass), temp);

    if (httpd_query_key_value(query, "server_url", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.register_url)) goto bad_req;
    safe_copy(cfg.register_url, sizeof(cfg.register_url), temp);

    if (httpd_query_key_value(query, "auth_token", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.auth_token)) goto bad_req;
    safe_copy(cfg.auth_token, sizeof(cfg.auth_token), temp);

    if (httpd_query_key_value(query, "device_id", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.device_id)) goto bad_req;
    safe_copy(cfg.device_id, sizeof(cfg.device_id), temp);

    /* manikin_id is optional and ignored by firmware; do not require or store it */

    if (httpd_query_key_value(query, "mqtt_host", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    if (strlen(temp) >= sizeof(cfg.mqtt_host)) goto bad_req;
    safe_copy(cfg.mqtt_host, sizeof(cfg.mqtt_host), temp);

    if (httpd_query_key_value(query, "mqtt_port", temp, sizeof(temp)) != ESP_OK) goto bad_req;
    url_decode_inplace(temp);
    long port = strtol(temp, NULL, 10);
    if (port <= 0 || port > 65535) goto bad_req;
    cfg.mqtt_port = (int)port;

    cfg.provisioned = true;

    /* Save and signal using shared helper */
    esp_err_t err = apply_provisioning_config(&cfg);
    if (err != ESP_OK) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        httpd_resp_set_type(req, "text/plain");
        httpd_resp_sendstr(req, "Failed to save provisioning");
        return err;
    }

    /* Send simple HTML success (do not reveal sensitive fields) */
    char reply[512];
    snprintf(reply, sizeof(reply),
             "<html><head><title>ResQ provisioning received</title></head><body>"
             "<h1>ResQ provisioning received</h1>"
             "<p>Wi-Fi SSID: %s</p>"
             "<p>Device ID: %s</p>"
             "<p>MQTT: %s:%d</p>"
             "<p>Device will now connect/reboot.</p>"
             "</body></html>",
             cfg.wifi_ssid, cfg.device_id, cfg.mqtt_host, cfg.mqtt_port);

    httpd_resp_set_type(req, "text/html");
    httpd_resp_sendstr(req, reply);
    return ESP_OK;

bad_req:
    httpd_resp_set_status(req, "400 Bad Request");
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_sendstr(req, "Missing or invalid provisioning fields");
    return ESP_ERR_INVALID_ARG;
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
    .method   = HTTP_POST,
    .handler  = provision_post_handler,
    .user_ctx = NULL,
};

static httpd_uri_t provision_get_uri = {
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
    httpd_register_uri_handler(s_server, &provision_get_uri);

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