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

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

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

typedef struct {
    SemaphoreHandle_t mutex;
    SemaphoreHandle_t lifecycle_mutex;
    bool initialized;
    provisioning_state_t state;
    network_config_t pending_network_config;
    network_config_t latest_network_config;
    char pending_ack_id[PROVISIONING_ACK_ID_MAX_LEN];
    uint32_t request_generation;
    esp_err_t last_error;
    httpd_handle_t http_server;
    esp_netif_t *ap_netif;
} provisioning_context_t;

static provisioning_context_t s_context;
static portMUX_TYPE s_init_lock = portMUX_INITIALIZER_UNLOCKED;

#if CONFIG_UNITY_ENABLE_IDF_TEST_RUNNER
static esp_err_t s_test_save_result = ESP_OK;
static bool s_test_save_override_enabled;
#endif

static bool state_is_running(provisioning_state_t state)
{
    return state == PROVISIONING_STATE_RUNNING ||
           state == PROVISIONING_STATE_WAITING_FOR_ACK ||
           state == PROVISIONING_STATE_COMMITTING ||
           state == PROVISIONING_STATE_SAVED;
}

static bool state_is_waiting(provisioning_state_t state)
{
    return state == PROVISIONING_STATE_WAITING_FOR_ACK;
}

static esp_err_t context_lock(void)
{
    if (!s_context.initialized || s_context.mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    return xSemaphoreTake(s_context.mutex, portMAX_DELAY) == pdTRUE
               ? ESP_OK
               : ESP_ERR_TIMEOUT;
}

static void context_unlock(void)
{
    xSemaphoreGive(s_context.mutex);
}

static esp_err_t save_network_config(network_config_t *config)
{
#if CONFIG_UNITY_ENABLE_IDF_TEST_RUNNER
    if (s_test_save_override_enabled) {
        return s_test_save_result;
    }
#endif
    return config_store_save_network(config);
}

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

static esp_err_t stage_provisioning_candidate(
    const network_config_t *candidate,
    const char *ack_id)
{
    if (candidate == NULL || ack_id == NULL || ack_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }

    if (s_context.state == PROVISIONING_STATE_STOPPING ||
        s_context.state == PROVISIONING_STATE_COMMITTING) {
        context_unlock();
        return ESP_ERR_INVALID_STATE;
    }
    if (!state_is_running(s_context.state)) {
        context_unlock();
        return ESP_ERR_INVALID_STATE;
    }

    s_context.request_generation++;
    if (s_context.request_generation == 0) {
        s_context.request_generation = 1;
    }
    s_context.pending_network_config = *candidate;
    err = copy_string_safe(s_context.pending_ack_id,
                           sizeof(s_context.pending_ack_id), ack_id);
    if (err == ESP_OK) {
        s_context.state = PROVISIONING_STATE_WAITING_FOR_ACK;
        s_context.last_error = ESP_OK;
    }
    context_unlock();
    return err;
}

static esp_err_t commit_matching_ack(const char *ack_id)
{
    if (ack_id == NULL || ack_id[0] == '\0') {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }
    if (!state_is_waiting(s_context.state)) {
        context_unlock();
        return ESP_ERR_INVALID_STATE;
    }
    if (strcmp(ack_id, s_context.pending_ack_id) != 0) {
        context_unlock();
        return ESP_ERR_INVALID_ARG;
    }

    network_config_t candidate = s_context.pending_network_config;
    const uint32_t generation = s_context.request_generation;
    s_context.state = PROVISIONING_STATE_COMMITTING;
    context_unlock();

    /* NVS may block. Never hold the provisioning state mutex across it. */
    err = save_network_config(&candidate);

    esp_err_t lock_err = context_lock();
    if (lock_err != ESP_OK) {
        return lock_err;
    }
    if (s_context.request_generation != generation ||
        s_context.state != PROVISIONING_STATE_COMMITTING) {
        s_context.state = PROVISIONING_STATE_ERROR;
        s_context.last_error = ESP_ERR_INVALID_STATE;
        context_unlock();
        return ESP_ERR_INVALID_STATE;
    }

    if (err == ESP_OK) {
        s_context.latest_network_config = candidate;
        s_context.pending_ack_id[0] = '\0';
        s_context.state = PROVISIONING_STATE_SAVED;
        s_context.last_error = ESP_OK;
    } else {
        /* Retain the ACK and candidate so the same request can retry. */
        s_context.state = PROVISIONING_STATE_WAITING_FOR_ACK;
        s_context.last_error = err;
    }
    context_unlock();
    return err;
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
    provisioning_status_t status = {0};

    config_store_get_device_mac(mac, sizeof(mac));
    esp_err_t status_err = provisioning_manager_get_status(&status);
    if (status_err != ESP_OK) {
        return send_json_response(
            req, 503, "{\"ok\":false,\"error\":\"status_unavailable\"}");
    }

    char response[200];

    int written = snprintf(response,
                           sizeof(response),
                           "{"
                           "\"device_mac\":\"%s\","
                           "\"running\":%s,"
                           "\"saved_config\":%s,"
                           "\"waiting_for_ack\":%s"
                           "}",
                           mac,
                           status.running ? "true" : "false",
                           status.saved_config_available ? "true" : "false",
                           status.waiting_for_ack ? "true" : "false");
    if (written < 0 || (size_t)written >= sizeof(response)) {
        return send_json_response(
            req, 500, "{\"ok\":false,\"error\":\"status_encode_failed\"}");
    }

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

    char ack_id[PROVISIONING_ACK_ID_MAX_LEN] = {0};
    generate_ack_id(ack_id, sizeof(ack_id));

    err = stage_provisioning_candidate(&config, ack_id);
    if (err != ESP_OK) {
        return send_json_response(
            req, 503, "{\"ok\":false,\"error\":\"provisioning_busy\"}");
    }

    char response[160];

    int written = snprintf(response,
                           sizeof(response),
                           "{"
                           "\"ok\":true,"
                           "\"message\":\"provisioning_received\","
                           "\"ack_id\":\"%s\""
                           "}",
                           ack_id);
    if (written < 0 || (size_t)written >= sizeof(response)) {
        return send_json_response(
            req, 500, "{\"ok\":false,\"error\":\"response_encode_failed\"}");
    }

    return send_json_response(req, 200, response);
}

/**
 * @brief Receive ACK from mobile/LocalHub to confirm provisioning config is received and saved.
 */
static esp_err_t provision_ack_post_handler(httpd_req_t *req)
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

    if (!has_ack) {
        return send_json_response(req,
                                  400,
                                  "{\"ok\":false,\"error\":\"invalid_ack_id\"}");
    }

    /*
     * Mobile confirmed that it received the ESP ACK.
     * Now save config permanently.
     */
    esp_err_t err = commit_matching_ack(received_ack_id);

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to save network config after ACK: %s",
                 esp_err_to_name(err));

        return send_json_response(req,
                                  err == ESP_ERR_INVALID_ARG ? 400 : 500,
                                  err == ESP_ERR_INVALID_ARG
                                      ? "{\"ok\":false,\"error\":\"invalid_ack_id\"}"
                                      : "{\"ok\":false,\"error\":\"nvs_save_failed\"}");
    }

    esp_err_t resp_err = send_json_response(req,
                                           200,
                                           "{\"ok\":true,\"message\":\"ack_confirmed_config_saved\"}");

    if (resp_err == ESP_OK) {
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

    esp_err_t err = httpd_start(&s_context.http_server, &config);

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

    httpd_register_uri_handler(s_context.http_server, &root_uri);
    httpd_register_uri_handler(s_context.http_server, &status_uri);
    httpd_register_uri_handler(s_context.http_server, &provision_uri);
    httpd_register_uri_handler(s_context.http_server, &provision_ack_uri);

    ESP_LOGI(TAG, "Provisioning HTTP server started");

    return ESP_OK;
}

static esp_err_t stop_http_server(void)
{
    if (s_context.http_server == NULL) {
        return ESP_OK;
    }

    esp_err_t err = httpd_stop(s_context.http_server);
    s_context.http_server = NULL;

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

    if (s_context.ap_netif == NULL) {
        s_context.ap_netif = esp_netif_create_default_wifi_ap();
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
    if (s_context.initialized) {
        return ESP_OK;
    }

    SemaphoreHandle_t mutex = xSemaphoreCreateMutex();
    SemaphoreHandle_t lifecycle_mutex = xSemaphoreCreateMutex();
    if (mutex == NULL || lifecycle_mutex == NULL) {
        if (mutex != NULL) {
            vSemaphoreDelete(mutex);
        }
        if (lifecycle_mutex != NULL) {
            vSemaphoreDelete(lifecycle_mutex);
        }
        return ESP_ERR_NO_MEM;
    }

    portENTER_CRITICAL(&s_init_lock);
    if (!s_context.initialized) {
        s_context.mutex = mutex;
        s_context.lifecycle_mutex = lifecycle_mutex;
        network_config_set_defaults(&s_context.latest_network_config);
        network_config_set_defaults(&s_context.pending_network_config);
        s_context.pending_ack_id[0] = '\0';
        s_context.request_generation = 0;
        s_context.last_error = ESP_OK;
        s_context.state = PROVISIONING_STATE_IDLE;
        s_context.initialized = true;
        mutex = NULL;
        lifecycle_mutex = NULL;
    }
    portEXIT_CRITICAL(&s_init_lock);

    if (mutex != NULL) {
        vSemaphoreDelete(mutex);
    }
    if (lifecycle_mutex != NULL) {
        vSemaphoreDelete(lifecycle_mutex);
    }

    ESP_LOGI(TAG, "Provisioning manager initialized");

    return ESP_OK;
}

esp_err_t provisioning_manager_start(void)
{
    if (!s_context.initialized || s_context.lifecycle_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(s_context.lifecycle_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        xSemaphoreGive(s_context.lifecycle_mutex);
        return err;
    }
    if (state_is_running(s_context.state)) {
        context_unlock();
        xSemaphoreGive(s_context.lifecycle_mutex);
        return ESP_OK;
    }
    if (s_context.state == PROVISIONING_STATE_STOPPING ||
        s_context.state == PROVISIONING_STATE_COMMITTING) {
        context_unlock();
        xSemaphoreGive(s_context.lifecycle_mutex);
        return ESP_ERR_INVALID_STATE;
    }

    network_config_set_defaults(&s_context.latest_network_config);
    network_config_set_defaults(&s_context.pending_network_config);
    s_context.pending_ack_id[0] = '\0';
    s_context.last_error = ESP_OK;
    s_context.state = PROVISIONING_STATE_IDLE;
    context_unlock();

    /* device_mac is not stored in the config; hardware MAC will be read at runtime. */

    err = start_softap();

    if (err != ESP_OK) {
        ESP_LOGE(TAG,
                 "Failed to start SoftAP: %s",
                 esp_err_to_name(err));
        if (context_lock() == ESP_OK) {
            s_context.state = PROVISIONING_STATE_ERROR;
            s_context.last_error = err;
            context_unlock();
        }
        xSemaphoreGive(s_context.lifecycle_mutex);
        return err;
    }

    err = start_http_server();

    if (err != ESP_OK) {
        stop_softap();
        if (context_lock() == ESP_OK) {
            s_context.state = PROVISIONING_STATE_ERROR;
            s_context.last_error = err;
            context_unlock();
        }
        xSemaphoreGive(s_context.lifecycle_mutex);
        return err;
    }

    if (context_lock() == ESP_OK) {
        s_context.state = PROVISIONING_STATE_RUNNING;
        s_context.last_error = ESP_OK;
        context_unlock();
    }
    xSemaphoreGive(s_context.lifecycle_mutex);

    ESP_LOGI(TAG, "Provisioning manager started");

    return ESP_OK;
}

esp_err_t provisioning_manager_stop(void)
{
    if (!s_context.initialized || s_context.lifecycle_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (xSemaphoreTake(s_context.lifecycle_mutex, portMAX_DELAY) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        xSemaphoreGive(s_context.lifecycle_mutex);
        return err;
    }
    if (s_context.state == PROVISIONING_STATE_IDLE) {
        context_unlock();
        xSemaphoreGive(s_context.lifecycle_mutex);
        return ESP_OK;
    }
    if (s_context.state == PROVISIONING_STATE_COMMITTING) {
        context_unlock();
        xSemaphoreGive(s_context.lifecycle_mutex);
        return ESP_ERR_INVALID_STATE;
    }
    s_context.state = PROVISIONING_STATE_STOPPING;
    context_unlock();

    esp_err_t http_err = stop_http_server();
    esp_err_t wifi_err = stop_softap();

    err = http_err != ESP_OK ? http_err : wifi_err;
    if (context_lock() == ESP_OK) {
        s_context.pending_ack_id[0] = '\0';
        s_context.state =
            err == ESP_OK ? PROVISIONING_STATE_IDLE : PROVISIONING_STATE_ERROR;
        s_context.last_error = err;
        context_unlock();
    }
    xSemaphoreGive(s_context.lifecycle_mutex);

    return err;
}

bool provisioning_manager_is_running(void)
{
    provisioning_status_t status = {0};
    return provisioning_manager_get_status(&status) == ESP_OK &&
           status.running;
}

bool provisioning_manager_has_saved_config(void)
{
    provisioning_status_t status = {0};
    return provisioning_manager_get_status(&status) == ESP_OK &&
           status.saved_config_available;
}

esp_err_t provisioning_manager_get_network_config(network_config_t *out_config)
{
    if (out_config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }
    *out_config = s_context.latest_network_config;
    context_unlock();

    return ESP_OK;
}

esp_err_t provisioning_manager_take_saved_config(network_config_t *out_config,
                                                 bool *out_available)
{
    if (out_config == NULL || out_available == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }

    *out_available = s_context.state == PROVISIONING_STATE_SAVED;
    if (*out_available) {
        *out_config = s_context.latest_network_config;
        s_context.state = PROVISIONING_STATE_RUNNING;
    }
    context_unlock();
    return ESP_OK;
}

esp_err_t provisioning_manager_get_status(provisioning_status_t *out_status)
{
    if (out_status == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }
    out_status->state = s_context.state;
    out_status->running = state_is_running(s_context.state);
    out_status->saved_config_available =
        s_context.state == PROVISIONING_STATE_SAVED;
    out_status->waiting_for_ack = state_is_waiting(s_context.state);
    out_status->request_generation = s_context.request_generation;
    out_status->last_error = s_context.last_error;
    context_unlock();
    return ESP_OK;
}

#if CONFIG_UNITY_ENABLE_IDF_TEST_RUNNER
esp_err_t provisioning_manager_test_reset(void)
{
    esp_err_t err = provisioning_manager_init();
    if (err != ESP_OK) {
        return err;
    }
    err = context_lock();
    if (err != ESP_OK) {
        return err;
    }
    network_config_set_defaults(&s_context.latest_network_config);
    network_config_set_defaults(&s_context.pending_network_config);
    s_context.pending_ack_id[0] = '\0';
    s_context.request_generation = 0;
    s_context.last_error = ESP_OK;
    s_context.state = PROVISIONING_STATE_RUNNING;
    s_test_save_result = ESP_OK;
    s_test_save_override_enabled = true;
    context_unlock();
    return ESP_OK;
}

void provisioning_manager_test_set_save_result(esp_err_t result)
{
    s_test_save_result = result;
}

esp_err_t provisioning_manager_test_submit(const network_config_t *candidate,
                                           char *out_ack_id,
                                           size_t out_ack_id_len)
{
    if (candidate == NULL || out_ack_id == NULL ||
        out_ack_id_len < PROVISIONING_ACK_ID_MAX_LEN) {
        return ESP_ERR_INVALID_ARG;
    }
    char ack_id[PROVISIONING_ACK_ID_MAX_LEN] = {0};
    generate_ack_id(ack_id, sizeof(ack_id));
    esp_err_t err = stage_provisioning_candidate(candidate, ack_id);
    if (err == ESP_OK) {
        err = copy_string_safe(out_ack_id, out_ack_id_len, ack_id);
    }
    return err;
}

esp_err_t provisioning_manager_test_commit_ack(const char *ack_id)
{
    return commit_matching_ack(ack_id);
}

esp_err_t provisioning_manager_test_set_stopping(void)
{
    esp_err_t err = context_lock();
    if (err != ESP_OK) {
        return err;
    }
    s_context.state = PROVISIONING_STATE_STOPPING;
    context_unlock();
    return ESP_OK;
}
#endif
