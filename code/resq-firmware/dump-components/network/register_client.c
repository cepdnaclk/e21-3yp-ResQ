#include "register_client.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"

static const char *TAG = "register_client";

typedef struct {
    char response[1024];
    int  response_len;
} http_ctx_t;

static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    http_ctx_t *ctx = (http_ctx_t *)evt->user_data;

    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (ctx && evt->data && evt->data_len > 0) {
                int remaining = (int)sizeof(ctx->response) - 1 - ctx->response_len;
                int copy_len = (evt->data_len < remaining) ? evt->data_len : remaining;

                if (copy_len > 0) {
                    memcpy(ctx->response + ctx->response_len, evt->data, copy_len);
                    ctx->response_len += copy_len;
                    ctx->response[ctx->response_len] = '\0';
                }
            }
            break;
        default:
            break;
    }

    return ESP_OK;
}

static void get_mac_string(char *out, size_t out_len)
{
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);

    snprintf(
        out,
        out_len,
        "%02X:%02X:%02X:%02X:%02X:%02X",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    );
}

esp_err_t register_client_send(const device_config_t *cfg, register_result_t *out)
{
    if (cfg == NULL || out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (cfg->register_url[0] == '\0') {
        return ESP_ERR_INVALID_STATE;
    }

    memset(out, 0, sizeof(*out));
    out->mqtt_port = 1883;

    char mac_str[18] = {0};
    get_mac_string(mac_str, sizeof(mac_str));

    cJSON *root = cJSON_CreateObject();
    if (!root) {
        return ESP_ERR_NO_MEM;
    }

    cJSON_AddStringToObject(root, "device_id", cfg->device_id);
    cJSON_AddStringToObject(root, "auth_token", cfg->auth_token);
    cJSON_AddStringToObject(root, "mac", mac_str);
    cJSON_AddStringToObject(root, "firmware_version", "resq-fw-v0.1");
    cJSON_AddStringToObject(root, "device_type", "cpr-node");

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (!body) {
        return ESP_ERR_NO_MEM;
    }

    http_ctx_t ctx = {0};

    esp_http_client_config_t http_cfg = {
        .url = cfg->register_url,
        .method = HTTP_METHOD_POST,
        .event_handler = http_event_handler,
        .user_data = &ctx,
        .timeout_ms = 10000,
    };

    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (client == NULL) {
        cJSON_free(body);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, body, strlen(body));

    ESP_LOGI(TAG, "Sending registration to: %s", cfg->register_url);

    esp_err_t err = esp_http_client_perform(client);
    cJSON_free(body);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "HTTP perform failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        return err;
    }

    int status = esp_http_client_get_status_code(client);
    ESP_LOGI(TAG, "Registration HTTP status: %d", status);
    esp_http_client_cleanup(client);

    if (status < 200 || status >= 300) {
        return ESP_FAIL;
    }

    cJSON *resp = cJSON_Parse(ctx.response);
    if (!resp) {
        ESP_LOGE(TAG, "Failed to parse registration response: %s", ctx.response);
        return ESP_FAIL;
    }

    cJSON *ok = cJSON_GetObjectItemCaseSensitive(resp, "ok");
    if (cJSON_IsBool(ok)) {
        out->ok = cJSON_IsTrue(ok);
    } else {
        out->ok = true;
    }

    cJSON *device_id = cJSON_GetObjectItemCaseSensitive(resp, "device_id");
    cJSON *mqtt_host = cJSON_GetObjectItemCaseSensitive(resp, "mqtt_host");
    cJSON *mqtt_port = cJSON_GetObjectItemCaseSensitive(resp, "mqtt_port");

    if (cJSON_IsString(device_id) && device_id->valuestring) {
        snprintf(out->assigned_device_id, sizeof(out->assigned_device_id), "%s", device_id->valuestring);
    }

    if (cJSON_IsString(mqtt_host) && mqtt_host->valuestring) {
        snprintf(out->mqtt_host, sizeof(out->mqtt_host), "%s", mqtt_host->valuestring);
    }

    if (cJSON_IsNumber(mqtt_port)) {
        out->mqtt_port = mqtt_port->valueint;
    }

    cJSON_Delete(resp);

    ESP_LOGI(TAG, "Registration accepted");
    ESP_LOGI(TAG, "  assigned device_id : %s", out->assigned_device_id);
    /* Backend may include manikin_id in responses; firmware ignores it */
    ESP_LOGI(TAG, "  mqtt_host          : %s", out->mqtt_host);
    ESP_LOGI(TAG, "  mqtt_port          : %d", out->mqtt_port);

    return ESP_OK;
}