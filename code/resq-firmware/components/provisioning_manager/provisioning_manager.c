#include "provisioning_manager.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"

#include "esp_err.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_random.h"

#include "config_store.h"

/* =========================================================
 * Provisioning manager configuration
 * ========================================================= */

#define PROVISIONING_AP_SSID_PREFIX        "ResQ-"
#define PROVISIONING_AP_CHANNEL            1
#define PROVISIONING_AP_MAX_CONNECTIONS    4

#define PROVISIONING_HTTP_PORT             80
#define PROVISIONING_MAX_BODY_LEN          512
#define PROVISIONING_BODY_TIMEOUT_RETRIES  3

#define PROVISIONING_ACK_ID_MAX_LEN        16
/* =========================================================
 * Private state
 * ========================================================= */

static const char *TAG = "provisioning_manager";

static httpd_handle_t s_http_server = NULL;
static esp_netif_t *s_ap_netif = NULL;

static bool s_initialized = false;
static bool s_running = false;
static bool s_saved_config = false;

static network_config_t s_pending_network_config;
static bool s_waiting_for_mobile_ack = false;
static char s_pending_ack_id[PROVISIONING_ACK_ID_MAX_LEN];

static network_config_t s_latest_network_config;

/* =========================================================
 * Small helper functions
 * ========================================================= */

/**
 * @brief Safely copy string into fixed-size destination.
 */
static esp_err_t copy_string_safe(char *dest,
                                  size_t dest_len,
                                  const char *src)
{
    if (dest == NULL || dest_len == 0 || src == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t src_len = strlen(src);

    if (src_len >= dest_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    memcpy(dest, src, src_len + 1);

    return ESP_OK;
}

static esp_err_t receive_full_body(httpd_req_t *req, char *body,
                                   size_t body_len)
{
    if (req == NULL || body == NULL || req->content_len <= 0 ||
        (size_t)req->content_len >= body_len) {
        return ESP_ERR_INVALID_ARG;
    }

    const size_t expected = (size_t)req->content_len;
    size_t received_total = 0;
    unsigned timeout_retries = 0;

    while (received_total < expected) {
        int received = httpd_req_recv(req, body + received_total,
                                      expected - received_total);
        if (received == HTTPD_SOCK_ERR_TIMEOUT) {
            if (++timeout_retries > PROVISIONING_BODY_TIMEOUT_RETRIES) {
                return ESP_ERR_TIMEOUT;
            }
            continue;
        }
        if (received <= 0) {
            return ESP_FAIL;
        }
        received_total += (size_t)received;
        timeout_retries = 0;
    }

    body[received_total] = '\0';
    return ESP_OK;
}

typedef enum {
    FORM_VALUE_NOT_FOUND = 0,
    FORM_VALUE_OK,
    FORM_VALUE_INVALID,
} form_value_result_t;

static bool hex_value(char input, uint8_t *out)
{
    if (out == NULL) {
        return false;
    }
    if (input >= '0' && input <= '9') {
        *out = (uint8_t)(input - '0');
        return true;
    }
    if (input >= 'A' && input <= 'F') {
        *out = (uint8_t)(input - 'A' + 10);
        return true;
    }
    if (input >= 'a' && input <= 'f') {
        *out = (uint8_t)(input - 'a' + 10);
        return true;
    }
    return false;
}

/**
 * @brief Decode exactly one URL-encoded form value without truncation.
 */
static esp_err_t url_decode_range(char *dst,
                                  size_t dst_len,
                                  const char *src,
                                  const char *src_end)
{
    size_t di = 0;

    if (dst == NULL || dst_len == 0 || src == NULL || src_end == NULL ||
        src_end < src) {
        return ESP_ERR_INVALID_ARG;
    }

    while (src < src_end) {
        if (di >= dst_len - 1) {
            dst[0] = '\0';
            return ESP_ERR_INVALID_SIZE;
        }

        if (*src == '+') {
            dst[di++] = ' ';
            src++;
        } else if (*src == '%') {
            uint8_t high = 0;
            uint8_t low = 0;
            if ((size_t)(src_end - src) < 3 ||
                !hex_value(src[1], &high) || !hex_value(src[2], &low)) {
                dst[0] = '\0';
                return ESP_ERR_INVALID_ARG;
            }
            uint8_t decoded = (uint8_t)((high << 4) | low);
            if (decoded == 0) {
                dst[0] = '\0';
                return ESP_ERR_INVALID_ARG;
            }
            dst[di++] = (char)decoded;
            src += 3;
        } else {
            dst[di++] = *src++;
        }
    }

    dst[di] = '\0';
    return ESP_OK;
}

/**
 * @brief Extract a value from URL-encoded form body.
 *
 * Example body:
 * wifi_ssid=ABC&wifi_pass=123&mqtt_port=1883
 */
static form_value_result_t form_get_value(const char *body,
                                          const char *key,
                                          char *out,
                                          size_t out_len)
{
    if (body == NULL || key == NULL || out == NULL || out_len == 0) {
        return FORM_VALUE_INVALID;
    }

    size_t key_len = strlen(key);
    const char *p = body;

    while (*p != '\0') {
        if (strncmp(p, key, key_len) == 0 && p[key_len] == '=') {
            const char *value_start = p + key_len + 1;
            const char *value_end = strchr(value_start, '&');

            if (value_end == NULL) {
                value_end = value_start + strlen(value_start);
            }
            return url_decode_range(out, out_len, value_start, value_end) == ESP_OK
                ? FORM_VALUE_OK
                : FORM_VALUE_INVALID;
        }

        p = strchr(p, '&');

        if (p == NULL) {
            break;
        }

        p++;
    }

    return FORM_VALUE_NOT_FOUND;
}

/**
 * @brief Extract string from JSON object.
 */
static esp_err_t json_get_string(cJSON *root,
                                 const char *key,
                                 char *dest,
                                 size_t dest_len)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);

    if (!cJSON_IsString(item) || item->valuestring == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    return copy_string_safe(dest, dest_len, item->valuestring);
}

/**
 * @brief Extract int from JSON object.
 */
static esp_err_t json_get_int(cJSON *root,
                              const char *key,
                              int32_t *out_value)
{
    cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);

    if (!cJSON_IsNumber(item) || out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    *out_value = (int32_t)item->valuedouble;

    return ESP_OK;
}

/**
 * @brief Parse provisioning payload as JSON.
 */
static esp_err_t parse_json_payload(const char *body,
                                    network_config_t *config)
{
    if (body == NULL || config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(body);

    if (root == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = ESP_OK;

    err = json_get_string(root,
                          "wifi_ssid",
                          config->wifi_ssid,
                          sizeof(config->wifi_ssid));
    if (err != ESP_OK) goto exit;

    /*
     * wifi_pass can be empty for open networks,
     * but usually it will be provided.
     */
    cJSON *pass = cJSON_GetObjectItemCaseSensitive(root, "wifi_pass");
    if (cJSON_IsString(pass) && pass->valuestring != NULL) {
        err = copy_string_safe(config->wifi_pass,
                               sizeof(config->wifi_pass),
                               pass->valuestring);
        if (err != ESP_OK) goto exit;
    }

    err = json_get_string(root,
                          "backend_base_url",
                          config->backend_base_url,
                          sizeof(config->backend_base_url));
    if (err != ESP_OK) goto exit;

exit:
    cJSON_Delete(root);
    return err;
}

/**
 * @brief Parse provisioning payload as form-urlencoded.
 */
static esp_err_t parse_form_payload(const char *body,
                                    network_config_t *config)
{
    if (body == NULL || config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (form_get_value(body,
                       "wifi_ssid",
                       config->wifi_ssid,
                       sizeof(config->wifi_ssid)) != FORM_VALUE_OK) {
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * Password is allowed to be empty,
     * so do not fail if wifi_pass is missing.
     */
    form_value_result_t password_result = form_get_value(
        body, "wifi_pass", config->wifi_pass, sizeof(config->wifi_pass));
    if (password_result == FORM_VALUE_INVALID) {
        return ESP_ERR_INVALID_SIZE;
    }

    if (form_get_value(body,
                       "backend_base_url",
                       config->backend_base_url,
                       sizeof(config->backend_base_url)) != FORM_VALUE_OK) {
        return ESP_ERR_INVALID_ARG;
    }

    return ESP_OK;
}

/**
 * @brief Parse received provisioning payload.
 *
 * Supports:
 * - JSON body
 * - application/x-www-form-urlencoded body
 */
esp_err_t provisioning_manager_parse_payload(const char *body,
                                             network_config_t *config)
{
    if (body == NULL || config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    network_config_t candidate;
    network_config_set_defaults(&candidate);

    /*
     * Try JSON first.
     */
    esp_err_t err = parse_json_payload(body, &candidate);

    if (err == ESP_OK) {
        memcpy(config, &candidate, sizeof(candidate));
        return ESP_OK;
    }

    /*
     * If JSON parsing fails, try form-urlencoded.
     */
    network_config_set_defaults(&candidate);
    err = parse_form_payload(body, &candidate);
    if (err == ESP_OK) {
        memcpy(config, &candidate, sizeof(candidate));
    }
    return err;
}

/**
 * @brief Get HTTP status text for status code.
 */
static const char *http_status_text(int status_code)
{
    switch (status_code) {
    case 200:
        return "200 OK";
    case 400:
        return "400 Bad Request";
    case 500:
        return "500 Internal Server Error";
    default:
        return "500 Internal Server Error";
    }
}

/**
 * @brief Send JSON response.
 */
static esp_err_t send_json_response(httpd_req_t *req,
                                    int status_code,
                                    const char *json)
{
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_status(req, http_status_text(status_code));

    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

/**
 * @brief Create SoftAP SSID using MAC last 3 bytes.
 *
 * Example:
 * ResQ-A1B2C3
 */
static esp_err_t build_softap_ssid(char *ssid, size_t ssid_len)
{
    if (ssid == NULL || ssid_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};

    esp_err_t err = config_store_get_device_mac(mac, sizeof(mac));
    if (err != ESP_OK) {
        return err;
    }

    /*
     * MAC format: AA:BB:CC:DD:EE:FF
     * Use DD EE FF as readable suffix.
     */
    int written = snprintf(ssid,
                           ssid_len,
                           "%s%c%c%c%c%c%c",
                           PROVISIONING_AP_SSID_PREFIX,
                           mac[9],
                           mac[10],
                           mac[12],
                           mac[13],
                           mac[15],
                           mac[16]);

    if (written <= 0 || written >= (int)ssid_len) {
        return ESP_FAIL;
    }

    return ESP_OK;
}

static esp_err_t build_softap_password(char *password, size_t password_len)
{
    if (password == NULL || password_len < 12) return ESP_ERR_INVALID_ARG;

    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    esp_err_t err = config_store_get_device_mac(mac, sizeof(mac));
    if (err != ESP_OK) return err;

    /* Avoid a fleet-wide credential. The matching derived value belongs on
     * the device's physical onboarding label, not in URLs or logs. */
    uint32_t hash = 2166136261u;
    const char *salt = "ResQ-Provisioning-v1:";
    for (const char *p = salt; *p != '\0'; ++p) {
        hash = (hash ^ (uint8_t)*p) * 16777619u;
    }
    for (const char *p = mac; *p != '\0'; ++p) {
        hash = (hash ^ (uint8_t)*p) * 16777619u;
    }

    int written = snprintf(password, password_len, "Rq!%08lX",
                           (unsigned long)hash);
    return written > 0 && (size_t)written < password_len ? ESP_OK : ESP_FAIL;
}

/**
 * @brief Generate random ACK ID for mobile/LocalHub to confirm provisioning.
 */
static void generate_ack_id(char *buffer, size_t buffer_len)
{
    if (buffer == NULL || buffer_len < PROVISIONING_ACK_ID_MAX_LEN) {
        return;
    }

    uint32_t random_value = esp_random();

    snprintf(buffer,
             buffer_len,
             "%08lX",
             (unsigned long)random_value);
}

/* =========================================================
 * HTTP handlers
 * ========================================================= */

static const char s_provisioning_page_html[] =
        "<!DOCTYPE html>"
        "<html>"
        "<head>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>ResQ Provisioning</title>"
        "<style>"
        "body{font-family:Arial;margin:0;padding:24px;background:#f7f9fc;}"
        "main{max-width:440px;margin:0 auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);}"
        "h2{margin:0 0 8px 0;}"
        "label{display:block;margin-top:12px;font-weight:600;}"
        "input{width:100%;padding:10px;margin-top:6px;box-sizing:border-box;border:1px solid #dbe6f0;border-radius:6px;}"
        "button{width:100%;margin-top:18px;padding:12px;background:#0b63ce;color:#fff;border:0;border-radius:8px;font-size:16px;}"
        "button:disabled{opacity:0.6;}"
        "#message{margin-top:16px;padding:10px;border-radius:8px;word-break:break-word;}"
        ".success{background:#e8f7ee;color:#146c2e;}"
        ".error{background:#fdeaea;color:#9f1c1c;}"
        "</style>"
        "</head>"
        "<body>"
        "<main>"
        "<h2>ResQ Device Provisioning</h2>"
        "<p>Enter LocalHub and Wi-Fi details to connect this device.</p>"
        "<form id='provisionForm'>"
        "<label for='wifi_ssid'>Wi-Fi SSID</label>"
        "<input id='wifi_ssid' name='wifi_ssid' required>"
        "<label for='wifi_pass'>Wi-Fi Password</label>"
        "<input id='wifi_pass' name='wifi_pass' type='password' autocomplete='current-password'>"
        "<label for='backend_base_url'>Backend Base URL</label>"
        "<input id='backend_base_url' name='backend_base_url' placeholder='http://192.168.8.100:18080' required>"
        "<button id='submitBtn' type='submit'>Save Configuration</button>"
        "</form>"
        "<div id='message'></div>"
        "</main>"
        "<script>"
        "(function(){"
        "  const form = document.getElementById('provisionForm');"
        "  const btn = document.getElementById('submitBtn');"
        "  const msg = document.getElementById('message');"

        "  function setMessage(text, isError){"
        "    msg.textContent = text;"
        "    msg.className = isError ? 'error' : 'success';"
        "  }"

        "  function applyQueryParams(){"
        "    const params = new URLSearchParams(window.location.search);"
        "    const fields = {"
        "      wifi_ssid: ['wifi_ssid','ssid'],"
        "      wifi_pass: ['wifi_pass','wifi_password','password'],"
        "      backend_base_url: ['backend_base_url','backend_url','hub_url']"
        "    };"
        "    let filled = 0;"
        "    Object.keys(fields).forEach(function(id){"
        "      const el = document.getElementById(id);"
        "      if(!el){ return; }"
        "      const aliases = fields[id];"
        "      for(let i = 0; i < aliases.length; i++){"
        "        if(params.has(aliases[i])){"
        "          el.value = params.get(aliases[i]);"
        "          filled++;"
        "          break;"
        "        }"
        "      }"
        "    });"
        "    if(filled > 0){ setMessage('Provisioning values loaded from QR. Review and press Save Configuration.', false); }"
        "  }"
        "  applyQueryParams();"

        "  async function readJsonSafe(response){"
        "    const text = await response.text();"
        "    try{ return JSON.parse(text); }catch(e){ throw new Error('Invalid JSON response: ' + text); }"
        "  }"

        "  form.addEventListener('submit', async function(event){"
        "    event.preventDefault();"
        "    btn.disabled = true;"
        "    setMessage('Sending provisioning details...', false);"

        "    const payload = {"
        "      wifi_ssid: document.getElementById('wifi_ssid').value.trim(),"
        "      wifi_pass: document.getElementById('wifi_pass').value,"
        "      backend_base_url: document.getElementById('backend_base_url').value.trim()"
        "    };"

        "    try{"
        "      const provisionResponse = await fetch('/provision', {"
        "        method: 'POST',"
        "        headers: {'Content-Type':'application/json'},"
        "        body: JSON.stringify(payload)"
        "      });"

        "      const provisionData = await readJsonSafe(provisionResponse);"

        "      if(!provisionResponse.ok || !provisionData.ok){"
        "        throw new Error(provisionData.error || 'Provisioning failed');"
        "      }"

        "      if(!provisionData.ack_id){"
        "        throw new Error('Missing ACK ID from device');"
        "      }"

        "      setMessage('Device received details. Confirming ACK...', false);"

        "      const ackResponse = await fetch('/provision/ack', {"
        "        method: 'POST',"
        "        headers: {'Content-Type':'application/json'},"
        "        body: JSON.stringify({ack_id: provisionData.ack_id})"
        "      });"

        "      const ackData = await readJsonSafe(ackResponse);"

        "      if(!ackResponse.ok || !ackData.ok){"
        "        throw new Error(ackData.error || 'ACK confirmation failed');"
        "      }"

        "      setMessage('Provisioning completed. Device is connecting to Wi-Fi...', false);"
        "    }catch(err){"
        "      setMessage('Error: ' + (err.message || err), true);"
        "      btn.disabled = false;"
        "    }"
        "  });"
        "})();"
        "</script>"
        "</body>"
        "</html>";

const char *provisioning_manager_get_page_html(void)
{
    return s_provisioning_page_html;
}

/**
 * @brief Simple provisioning page.
 */
static esp_err_t root_get_handler(httpd_req_t *req)
{
    const char *html = provisioning_manager_get_page_html();

    httpd_resp_set_type(req, "text/html");

    return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

/**
 * @brief Status endpoint for mobile/LocalHub.
 */
static esp_err_t status_get_handler(httpd_req_t *req)
{
    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};

    config_store_get_device_mac(mac, sizeof(mac));

    char response[200];

    snprintf(response,
             sizeof(response),
             "{"
             "\"device_mac\":\"%s\"," 
             "\"running\":%s," 
             "\"saved_config\":%s," 
             "\"waiting_for_ack\":%s"
             "}",
             mac,
             s_running ? "true" : "false",
             s_saved_config ? "true" : "false",
             s_waiting_for_mobile_ack ? "true" : "false");

    return send_json_response(req, 200, response);
}

/**
 * @brief Receive provisioning config.
 *
 * Accepted JSON:
 * {
 *   "wifi_ssid": "ResQ-Lab",
 *   "wifi_pass": "password",
 *   "backend_base_url": "http://192.168.8.100:18080"
 * }
 */
static esp_err_t provision_post_handler(httpd_req_t *req)
{
    if (req->content_len <= 0 ||
        req->content_len >= PROVISIONING_MAX_BODY_LEN) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"invalid_body_size\"}");
    }

    char body[PROVISIONING_MAX_BODY_LEN] = {0};

    if (receive_full_body(req, body, sizeof(body)) != ESP_OK) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"body_read_failed\"}");
    }

    network_config_t config;
    network_config_set_defaults(&config);

    esp_err_t err = provisioning_manager_parse_payload(body, &config);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "Provisioning payload parse failed");
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"invalid_payload\"}");
    }

    /* device_mac is read at runtime when needed. */

    /*
     * Validation also sets config.provisioned true/false.
     */
    if (!network_config_validate(&config)) {
        ESP_LOGW(TAG, "Network config validation failed");

        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"validation_failed\"}");
    }

    memcpy(&s_pending_network_config,
        &config,
        sizeof(network_config_t));

    generate_ack_id(s_pending_ack_id,
                    sizeof(s_pending_ack_id));

    s_waiting_for_mobile_ack = true;
    s_saved_config = false;

    char response[160];

    snprintf(response,
            sizeof(response),
            "{"
            "\"ok\":true,"
            "\"message\":\"provisioning_received\","
            "\"ack_id\":\"%s\""
            "}",
            s_pending_ack_id);

    return send_json_response(req, 200, response);
}

/**
 * @brief Receive ACK from mobile/LocalHub to confirm provisioning config is received and saved.
 */
static esp_err_t provision_ack_post_handler(httpd_req_t *req)
{
    if (!s_waiting_for_mobile_ack) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"no_pending_ack\"}");
    }

    if (req->content_len <= 0 ||
        req->content_len >= PROVISIONING_MAX_BODY_LEN) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"invalid_body_size\"}");
    }

    char body[PROVISIONING_MAX_BODY_LEN] = {0};

    if (receive_full_body(req, body, sizeof(body)) != ESP_OK) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"body_read_failed\"}");
    }

    char received_ack_id[PROVISIONING_ACK_ID_MAX_LEN] = {0};

    /*
     * Support form body:
     * ack_id=XXXXXXXX
     */
    bool has_ack = form_get_value(body,
                                  "ack_id",
                                  received_ack_id,
                                  sizeof(received_ack_id)) == FORM_VALUE_OK;

    /*
     * Support JSON body:
     * { "ack_id": "XXXXXXXX" }
     */
    if (!has_ack) {
        cJSON *root = cJSON_Parse(body);

        if (root != NULL) {
            cJSON *ack = cJSON_GetObjectItemCaseSensitive(root, "ack_id");

            if (cJSON_IsString(ack) && ack->valuestring != NULL) {
                copy_string_safe(received_ack_id,
                                 sizeof(received_ack_id),
                                 ack->valuestring);
                has_ack = true;
            }

            cJSON_Delete(root);
        }
    }

    if (!has_ack ||
        strcmp(received_ack_id, s_pending_ack_id) != 0) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"invalid_ack_id\"}");
    }

    /*
     * Mobile confirmed that it received the ESP ACK.
     * Now save config permanently.
     */
    /* Save network config to NVS first. Do not set s_saved_config until
     * we successfully send the final HTTP response to the mobile client.
     */
    esp_err_t err = config_store_save_network(&s_pending_network_config);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to save network config after ACK: %s",
                 esp_err_to_name(err));

        return send_json_response(req,
                                  500,
                                  "{\"ok\":false,\"error\":\"nvs_save_failed\"}");
    }

    /* Send final HTTP response first. Only mark config saved if response sent. */
    esp_err_t resp_err = send_json_response(req,
                                           200,
                                           "{\"ok\":true,\"message\":\"ack_confirmed_config_saved\"}");

    if (resp_err == ESP_OK) {
        memcpy(&s_latest_network_config,
               &s_pending_network_config,
               sizeof(network_config_t));

        s_saved_config = true;
        s_waiting_for_mobile_ack = false;
        s_pending_ack_id[0] = '\0';

        ESP_LOGI(TAG, "Mobile ACK confirmed. Provisioning config saved.");
    } else {
        ESP_LOGW(TAG, "Failed to send final ACK response: %s", esp_err_to_name(resp_err));
    }

    return resp_err;
}

/* =========================================================
 * HTTP server start/stop
 * ========================================================= */

static esp_err_t start_http_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();

    config.server_port = PROVISIONING_HTTP_PORT;
    config.uri_match_fn = httpd_uri_match_wildcard;

    esp_err_t err = httpd_start(&s_http_server, &config);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to start HTTP server: %s",
                 esp_err_to_name(err));

        return err;
    }

    httpd_uri_t root_uri = {
        .uri = "/",
        .method = HTTP_GET,
        .handler = root_get_handler,
        .user_ctx = NULL,
    };

    httpd_uri_t status_uri = {
        .uri = "/status",
        .method = HTTP_GET,
        .handler = status_get_handler,
        .user_ctx = NULL,
    };

    httpd_uri_t provision_uri = {
        .uri = "/provision",
        .method = HTTP_POST,
        .handler = provision_post_handler,
        .user_ctx = NULL,
    };

    httpd_uri_t provision_ack_uri = {
        .uri = "/provision/ack",
        .method = HTTP_POST,
        .handler = provision_ack_post_handler,
        .user_ctx = NULL,
    };

    httpd_register_uri_handler(s_http_server, &root_uri);
    httpd_register_uri_handler(s_http_server, &status_uri);
    httpd_register_uri_handler(s_http_server, &provision_uri);
    httpd_register_uri_handler(s_http_server, &provision_ack_uri);

    ESP_LOGI(TAG, "Provisioning HTTP server started");

    return ESP_OK;
}

static esp_err_t stop_http_server(void)
{
    if (s_http_server == NULL) {
        return ESP_OK;
    }

    esp_err_t err = httpd_stop(s_http_server);
    s_http_server = NULL;

    return err;
}

/* =========================================================
 * Wi-Fi SoftAP start/stop
 * ========================================================= */

static esp_err_t start_softap(void)
{
    esp_err_t err;

    err = esp_netif_init();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    if (s_ap_netif == NULL) {
        s_ap_netif = esp_netif_create_default_wifi_ap();
    }

    wifi_init_config_t wifi_init_cfg = WIFI_INIT_CONFIG_DEFAULT();

    err = esp_wifi_init(&wifi_init_cfg);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        return err;
    }

    char ap_ssid[32] = {0};
    char ap_password[16] = {0};

    err = build_softap_ssid(ap_ssid, sizeof(ap_ssid));
    if (err != ESP_OK) {
        return err;
    }
    err = build_softap_password(ap_password, sizeof(ap_password));
    if (err != ESP_OK) return err;

    wifi_config_t ap_config = {0};

    copy_string_safe((char *)ap_config.ap.ssid,
                     sizeof(ap_config.ap.ssid),
                     ap_ssid);

    copy_string_safe((char *)ap_config.ap.password,
                     sizeof(ap_config.ap.password),
                     ap_password);

    ap_config.ap.ssid_len = strlen(ap_ssid);
    ap_config.ap.channel = PROVISIONING_AP_CHANNEL;
    ap_config.ap.max_connection = PROVISIONING_AP_MAX_CONNECTIONS;

    ap_config.ap.authmode = WIFI_AUTH_WPA2_PSK;

    err = esp_wifi_set_mode(WIFI_MODE_AP);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_set_config(WIFI_IF_AP, &ap_config);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_wifi_start();
    if (err != ESP_OK && err != ESP_ERR_WIFI_CONN) {
        return err;
    }

    ESP_LOGI(TAG,
             "Provisioning SoftAP started SSID=%s url=http://192.168.4.1; use device onboarding credential",
             ap_ssid);

    return ESP_OK;
}

static esp_err_t stop_softap(void)
{
    esp_err_t err = esp_wifi_stop();

    if (err != ESP_OK &&
        err != ESP_ERR_WIFI_NOT_INIT &&
        err != ESP_ERR_WIFI_NOT_STARTED) {
        return err;
    }

    return ESP_OK;
}

/* =========================================================
 * Public API
 * ========================================================= */

esp_err_t provisioning_manager_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    network_config_set_defaults(&s_latest_network_config);
    network_config_set_defaults(&s_pending_network_config);

    s_saved_config = false;
    s_waiting_for_mobile_ack = false;
    s_pending_ack_id[0] = '\0';
    s_running = false;
    s_initialized = true;

    ESP_LOGI(TAG, "Provisioning manager initialized");

    return ESP_OK;
}

esp_err_t provisioning_manager_start(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_running) {
        return ESP_OK;
    }

    s_saved_config = false;
    s_waiting_for_mobile_ack = false;
    s_pending_ack_id[0] = '\0';
    network_config_set_defaults(&s_latest_network_config);
    network_config_set_defaults(&s_pending_network_config);

    /* device_mac is not stored in the config; hardware MAC will be read at runtime. */

    esp_err_t err = start_softap();

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to start SoftAP: %s",
                 esp_err_to_name(err));

        return err;
    }

    err = start_http_server();

    if (err != ESP_OK) {
        stop_softap();
        return err;
    }

    s_running = true;

    ESP_LOGI(TAG, "Provisioning manager started");

    return ESP_OK;
}

esp_err_t provisioning_manager_stop(void)
{
    if (!s_running) {
        return ESP_OK;
    }

    esp_err_t http_err = stop_http_server();
    esp_err_t wifi_err = stop_softap();

    s_running = false;

    if (http_err != ESP_OK) {
        return http_err;
    }

    return wifi_err;
}

bool provisioning_manager_is_running(void)
{
    return s_running;
}

bool provisioning_manager_has_saved_config(void)
{
    return s_saved_config;
}

esp_err_t provisioning_manager_get_network_config(network_config_t *out_config)
{
    if (out_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memcpy(out_config,
           &s_latest_network_config,
           sizeof(network_config_t));

    return ESP_OK;
}
