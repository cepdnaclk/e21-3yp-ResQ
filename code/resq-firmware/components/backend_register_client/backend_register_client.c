#include "backend_register_client.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

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

    int written = snprintf(
        buffer,
        buffer_len,
        "{"
            "\"device_mac\":\"%s\"," 
            "\"device_id\":\"%s\"," 
            "\"firmware_version\":\"0.1.0\""
        "}",
        config->device_mac,
        config->device_id
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

esp_err_t backend_register_client_register(network_config_t *config)
{
    if (config == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (config->register_url[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    if (config->device_mac[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

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


    esp_http_client_config_t http_cfg = {
        .url = config->register_url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &resp,
        .timeout_ms = BACKEND_REGISTER_TIMEOUT_MS,
    };

    ESP_LOGI(TAG, "Sending registration to: %s", config->register_url);

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
            strncpy(config->device_id, device_id->valuestring, sizeof(config->device_id) - 1);
            config->device_id[sizeof(config->device_id) - 1] = '\0';

            /* Optional fields */
            cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(resp_json, "mqtt_host");
            cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(resp_json, "mqtt_port");

            if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring) {
                strncpy(config->mqtt_host, mqtt_host->valuestring, sizeof(config->mqtt_host) - 1);
                config->mqtt_host[sizeof(config->mqtt_host) - 1] = '\0';
            }

            if (cJSON_IsNumber(mqtt_port)) {
                config->mqtt_port = mqtt_port->valueint;
            }

            cJSON_Delete(resp_json);
            esp_http_client_cleanup(client_attempt);

            ESP_LOGI(TAG, "Registration complete device_id=%s mqtt_host=%s mqtt_port=%d",
                     config->device_id,
                     config->mqtt_host,
                     config->mqtt_port);

            return ESP_OK;
        }

        /* Non-2xx HTTP status: cleanup and retry */
        esp_http_client_cleanup(client_attempt);
        err = ESP_FAIL;
        vTaskDelay(pdMS_TO_TICKS(1000));
    }

    return err;
}
