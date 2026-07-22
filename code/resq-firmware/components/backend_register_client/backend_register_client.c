#include "backend_register_client.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "config_store.h"

static const char *TAG = "backend_register";

typedef struct
{
    char *buffer;
    int buffer_len;
    int written;
    bool overflow;
} backend_http_response_t;

static bool response_string_valid(const char *value, size_t capacity,
                                  bool host)
{
    if (value == NULL) return false;
    size_t len = strnlen(value, capacity);
    if (len == 0 || len >= capacity) return false;
    for (size_t i = 0; i < len; ++i) {
        unsigned char c = (unsigned char)value[i];
        if (isalnum(c) || c == '-' || c == '_' ||
            (host && (c == '.' || c == ':' || c == '[' || c == ']'))) {
            continue;
        }
        return false;
    }
    return true;
}

esp_err_t backend_register_client_build_request_body(const char *device_mac,
                                                     char *buffer,
                                                     size_t buffer_len)
{
    if (device_mac == NULL || device_mac[0] == '\0' || buffer == NULL ||
        buffer_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    int written = snprintf(
        buffer,
        buffer_len,
        "{"
            "\"device_mac\":\"%s\"," 
            "\"firmware_version\":\"0.1.0\""
        "}",
        device_mac
    );

    if (written <= 0 || written >= (int)buffer_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    return ESP_OK;
}

esp_err_t backend_register_client_build_url(const char *backend_base_url,
                                            char *out_url,
                                            size_t out_url_len)
{
    if (backend_base_url == NULL || out_url == NULL || out_url_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    size_t base_len = strnlen(backend_base_url,
                              RESQ_BACKEND_BASE_URL_MAX_LEN);
    if (base_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    if (base_len >= RESQ_BACKEND_BASE_URL_MAX_LEN) {
        return ESP_ERR_INVALID_SIZE;
    }

    while (base_len > 0 && backend_base_url[base_len - 1] == '/') {
        base_len--;
    }
    if (base_len == 0 || base_len + strlen(BACKEND_REGISTER_PATH) >= out_url_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    int written = snprintf(out_url, out_url_len, "%.*s%s", (int)base_len,
                           backend_base_url, BACKEND_REGISTER_PATH);
    return written > 0 && (size_t)written < out_url_len
        ? ESP_OK
        : ESP_ERR_INVALID_SIZE;
}

esp_err_t backend_register_client_parse_response(
    const char *response_json,
    backend_registration_result_t *out_result)
{
    if (response_json == NULL || out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    cJSON *root = cJSON_Parse(response_json);
    if (root == NULL) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    backend_registration_result_t candidate = {0};
    cJSON *device_id = cJSON_GetObjectItemCaseSensitive(root, "device_id");
    cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(root, "mqtt_host");
    cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(root, "mqtt_port");

    bool valid = cJSON_IsString(device_id) &&
                 response_string_valid(device_id->valuestring,
                                       sizeof(candidate.device_id), false) &&
                 cJSON_IsString(mqtt_host) &&
                 response_string_valid(mqtt_host->valuestring,
                                       sizeof(candidate.mqtt_host), true) &&
                 cJSON_IsNumber(mqtt_port) &&
                 isfinite(mqtt_port->valuedouble) &&
                 floor(mqtt_port->valuedouble) == mqtt_port->valuedouble &&
                 mqtt_port->valuedouble >= 1.0 &&
                 mqtt_port->valuedouble <= 65535.0;
    if (!valid) {
        cJSON_Delete(root);
        return ESP_ERR_INVALID_RESPONSE;
    }

    memcpy(candidate.device_id, device_id->valuestring,
           strlen(device_id->valuestring) + 1);
    memcpy(candidate.mqtt_host, mqtt_host->valuestring,
           strlen(mqtt_host->valuestring) + 1);
    candidate.mqtt_port = (uint16_t)mqtt_port->valuedouble;
    cJSON_Delete(root);

    memcpy(out_result, &candidate, sizeof(candidate));
    return ESP_OK;
}

static void sanitize_url_for_log(const char *url, char *out, size_t out_len)
{
    if (url == NULL || out == NULL || out_len == 0) {
        return;
    }
    snprintf(out, out_len, "%s", url);

    char *query = strpbrk(out, "?#");
    if (query != NULL) {
        *query = '\0';
    }

    char *scheme = strstr(out, "://");
    char *authority = scheme != NULL ? scheme + 3 : out;
    char *path = strchr(authority, '/');
    char *authority_end = path != NULL ? path : out + strlen(out);
    char *at = memchr(authority, '@', (size_t)(authority_end - authority));
    if (at != NULL) {
        memmove(authority, at + 1, strlen(at + 1) + 1);
    }
}

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    backend_http_response_t *ctx = (backend_http_response_t *)evt->user_data;

    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (ctx && evt->data && evt->data_len > 0) {
                int remaining = ctx->buffer_len - 1 - ctx->written;
                int copy_len = (evt->data_len < remaining) ? evt->data_len : remaining;

                if (copy_len > 0) {
                    memcpy(ctx->buffer + ctx->written, evt->data, copy_len);
                    ctx->written += copy_len;
                    ctx->buffer[ctx->written] = '\0';
                }
                if (copy_len < evt->data_len) {
                    ctx->overflow = true;
                }
            }
            break;
        default:
            break;
    }

    return ESP_OK;
}

esp_err_t backend_register_client_init(void)
{
    return ESP_OK;
}

esp_err_t backend_register_client_register(const network_config_t *config,
                                           backend_registration_result_t *out_result)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (config->backend_base_url[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    if (out_result == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    char body_buf[256];
    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    esp_err_t berr = config_store_get_device_mac(mac, sizeof(mac));
    if (berr != ESP_OK) {
        return berr;
    }
    berr = backend_register_client_build_request_body(mac, body_buf,
                                                      sizeof(body_buf));
    if (berr != ESP_OK) {
        return berr;
    }

    backend_http_response_t resp = {0};
    char resp_buf[2048];
    resp.buffer = resp_buf;
    resp.buffer_len = sizeof(resp_buf);
    resp.written = 0;


    char register_url[256] = {0};
    berr = backend_register_client_build_url(config->backend_base_url,
                                             register_url,
                                             sizeof(register_url));
    if (berr != ESP_OK) {
        return berr;
    }

    esp_http_client_config_t http_cfg = {
        .url = register_url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &resp,
        .timeout_ms = BACKEND_REGISTER_TIMEOUT_MS,
    };

    char safe_register_url[sizeof(register_url)] = {0};
    sanitize_url_for_log(register_url, safe_register_url,
                         sizeof(safe_register_url));
    ESP_LOGI(TAG, "Sending registration to: %s", safe_register_url);

    esp_err_t err = ESP_FAIL;

    for (int attempt = 1; attempt <= BACKEND_REGISTER_MAX_RETRIES; ++attempt) {
        resp.written = 0;
        resp.overflow = false;
        resp.buffer[0] = '\0';

        esp_http_client_handle_t client_attempt = esp_http_client_init(&http_cfg);
        if (client_attempt == NULL) {
            ESP_LOGW(TAG, "Failed to init HTTP client (attempt %d)", attempt);
            err = ESP_FAIL;
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        esp_http_client_set_header(client_attempt, "Content-Type", "application/json");
        esp_http_client_set_post_field(client_attempt, body_buf, strlen(body_buf));

        esp_err_t perr = esp_http_client_perform(client_attempt);

        if (perr != ESP_OK) {
            ESP_LOGW(TAG, "HTTP perform failed attempt %d: %s", attempt, esp_err_to_name(perr));
            err = perr;
            esp_http_client_cleanup(client_attempt);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }

        int status = esp_http_client_get_status_code(client_attempt);
        ESP_LOGI(TAG, "Registration HTTP status: %d", status);

        /* Read response written into resp.buffer by the event handler */
        if (status >= 200 && status < 300) {
            if (resp.overflow) {
                ESP_LOGE(TAG, "Registration response exceeds %d bytes",
                         resp.buffer_len - 1);
                esp_http_client_cleanup(client_attempt);
                err = ESP_ERR_INVALID_RESPONSE;
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }
            esp_err_t parse_err = backend_register_client_parse_response(
                resp.buffer, out_result);
            if (parse_err != ESP_OK) {
                ESP_LOGE(TAG, "Registration response parsing failed");
                esp_http_client_cleanup(client_attempt);
                err = ESP_ERR_INVALID_RESPONSE;
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }
            esp_http_client_cleanup(client_attempt);

            ESP_LOGI(TAG, "Registration response parsed successfully");
            ESP_LOGI(TAG, "Registration complete device_id=%s mqtt_host=%s mqtt_port=%d",
                     out_result->device_id,
                     out_result->mqtt_host,
                     out_result->mqtt_port);

            return ESP_OK;
        }

        /* Non-2xx HTTP status: cleanup and retry */
        esp_http_client_cleanup(client_attempt);
        err = ESP_FAIL;
        vTaskDelay(pdMS_TO_TICKS(1000));
    }

    return err;
}
