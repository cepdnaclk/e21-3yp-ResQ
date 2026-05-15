#include "backend_register_client.h"

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
} backend_http_response_t;

static esp_err_t backend_register_build_request_body(const network_config_t *config,
                                                     char *buffer,
                                                     size_t buffer_len)
{
    if (config == NULL || buffer == NULL || buffer_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    /* Read hardware MAC at runtime */
    char mac[RESQ_DEVICE_MAC_MAX_LEN] = {0};
    esp_err_t merr = config_store_get_device_mac(mac, sizeof(mac));
    if (merr != ESP_OK) {
        return merr;
    }

    int written = snprintf(
        buffer,
        buffer_len,
        "{"
            "\"device_mac\":\"%s\"," 
            "\"firmware_version\":\"0.1.0\""
        "}",
        mac
    );

    if (written <= 0 || written >= (int)buffer_len) {
        return ESP_ERR_INVALID_SIZE;
    }

    return ESP_OK;
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

    out_result->device_id[0] = '\0';
    out_result->mqtt_host[0] = '\0';
    out_result->mqtt_port = 0;

    char body_buf[256];
    esp_err_t berr = backend_register_build_request_body(config, body_buf, sizeof(body_buf));
    if (berr != ESP_OK) {
        return berr;
    }

    backend_http_response_t resp = {0};
    char resp_buf[2048];
    resp.buffer = resp_buf;
    resp.buffer_len = sizeof(resp_buf);
    resp.written = 0;


    /* Build register URL from backend base URL. Trim trailing slash. */
    char register_url[256] = {0};
    static const char register_path[] = "/api/devices/register";

    size_t base_len = strnlen(config->backend_base_url,
                            sizeof(config->backend_base_url));

    if (base_len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    if (base_len >= sizeof(config->backend_base_url)) {
        ESP_LOGE(TAG, "Backend base URL is not null-terminated");
        return ESP_ERR_INVALID_SIZE;
    }

    /* Copy backend base URL safely into larger register_url buffer. */
    int written = snprintf(register_url,
                        sizeof(register_url),
                        "%s",
                        config->backend_base_url);

    if (written <= 0 || written >= (int)sizeof(register_url)) {
        return ESP_ERR_INVALID_SIZE;
    }

    /* Trim trailing slash, if present. */
    size_t url_len = strlen(register_url);
    while (url_len > 0 && register_url[url_len - 1] == '/') {
        register_url[url_len - 1] = '\0';
        url_len--;
    }

    /* Append fixed registration endpoint safely. */
    if (url_len + strlen(register_path) >= sizeof(register_url)) {
        ESP_LOGE(TAG, "Register URL is too long");
        return ESP_ERR_INVALID_SIZE;
    }

    strncat(register_url,
            register_path,
            sizeof(register_url) - strlen(register_url) - 1);

    esp_http_client_config_t http_cfg = {
        .url = register_url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &resp,
        .timeout_ms = BACKEND_REGISTER_TIMEOUT_MS,
    };

    ESP_LOGI(TAG, "Sending registration to: %s", register_url);

    esp_err_t err = ESP_FAIL;

    for (int attempt = 1; attempt <= BACKEND_REGISTER_MAX_RETRIES; ++attempt) {
        resp.written = 0;
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
            if (resp.written == 0) {
                ESP_LOGW(TAG, "Empty registration response");
            }

            /* Parse response and require device_id */
            cJSON *resp_json = cJSON_Parse(resp.buffer);
            if (!resp_json) {
                ESP_LOGE(TAG, "Failed to parse registration response: %s", resp.buffer);
                esp_http_client_cleanup(client_attempt);
                err = ESP_FAIL;
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }

            cJSON *device_id = cJSON_GetObjectItemCaseSensitive(resp_json, "device_id");
            if (!cJSON_IsString(device_id) || device_id->valuestring == NULL || device_id->valuestring[0] == '\0') {
                ESP_LOGE(TAG, "Backend response missing device_id");
                cJSON_Delete(resp_json);
                esp_http_client_cleanup(client_attempt);
                err = ESP_FAIL;
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }

            /* Required device_id */
            strncpy(out_result->device_id, device_id->valuestring, sizeof(out_result->device_id) - 1);
            out_result->device_id[sizeof(out_result->device_id) - 1] = '\0';

            /* Optional fields */
            cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(resp_json, "mqtt_host");
            cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(resp_json, "mqtt_port");

            if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring) {
                strncpy(out_result->mqtt_host, mqtt_host->valuestring, sizeof(out_result->mqtt_host) - 1);
                out_result->mqtt_host[sizeof(out_result->mqtt_host) - 1] = '\0';
            }

            if (cJSON_IsNumber(mqtt_port)) {
                out_result->mqtt_port = (uint16_t)mqtt_port->valueint;
            }

            cJSON_Delete(resp_json);
            esp_http_client_cleanup(client_attempt);

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
