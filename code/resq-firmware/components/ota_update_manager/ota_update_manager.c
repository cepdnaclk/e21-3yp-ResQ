#include "ota_update_manager.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"

#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "config_store.h"
#include "mqtt_manager.h"

#ifndef CONFIG_RESQ_OTA_ACCESS_KEY
#define CONFIG_RESQ_OTA_ACCESS_KEY "resq-ota-key"
#endif

#ifndef CONFIG_RESQ_OTA_TOKEN_TTL_SECONDS
#define CONFIG_RESQ_OTA_TOKEN_TTL_SECONDS 300
#endif

#define OTA_UPLOAD_BUFFER_SIZE 2048
#define OTA_LOGIN_BODY_MAX_LEN 192
#define OTA_PROGRESS_STEP_PCT 5

enum
{
    OTA_ERROR_NONE = 0,
    OTA_ERROR_AUTH_FAILED = 1001,
    OTA_ERROR_NO_UPDATE_PARTITION = 1002,
    OTA_ERROR_BEGIN_FAILED = 1003,
    OTA_ERROR_RECEIVE_FAILED = 1004,
    OTA_ERROR_WRITE_FAILED = 1005,
    OTA_ERROR_VERIFY_FAILED = 1006,
    OTA_ERROR_SET_BOOT_FAILED = 1007,
    OTA_ERROR_METADATA_SAVE_FAILED = 1008
};

static const char *TAG = "ota_update_manager";

static SemaphoreHandle_t s_status_mutex = NULL;
static httpd_handle_t s_registered_server = NULL;
static ota_update_status_t s_status;
static ota_metadata_t s_metadata;
static char s_session_token[33] = {0};
static int64_t s_session_expires_at_ms = 0;

static int64_t ota_now_ms(void)
{
    return esp_timer_get_time() / 1000;
}

const char *ota_update_manager_phase_to_string(ota_phase_t phase)
{
    switch (phase) {
    case OTA_PHASE_IDLE:
        return "IDLE";
    case OTA_PHASE_AUTHENTICATING:
        return "AUTHENTICATING";
    case OTA_PHASE_RECEIVING:
        return "RECEIVING";
    case OTA_PHASE_WRITING:
        return "WRITING";
    case OTA_PHASE_VERIFYING:
        return "VERIFYING";
    case OTA_PHASE_SET_BOOT_PARTITION:
        return "SET_BOOT_PARTITION";
    case OTA_PHASE_SUCCESS_REBOOTING:
        return "SUCCESS_REBOOTING";
    case OTA_PHASE_FAILED:
        return "FAILED";
    default:
        return "UNKNOWN";
    }
}

static void ota_lock(void)
{
    if (s_status_mutex != NULL) {
        xSemaphoreTake(s_status_mutex, portMAX_DELAY);
    }
}

static void ota_unlock(void)
{
    if (s_status_mutex != NULL) {
        xSemaphoreGive(s_status_mutex);
    }
}

static void ota_set_phase(ota_phase_t phase)
{
    ota_lock();
    s_status.phase = phase;
    ota_unlock();
}

static void ota_set_progress(int32_t bytes_written, int32_t total_size)
{
    ota_lock();
    s_status.bytes_written = bytes_written;
    s_status.total_size = total_size;
    s_status.progress_pct = total_size > 0
        ? (int32_t)(((int64_t)bytes_written * 100) / total_size)
        : 0;
    if (s_status.progress_pct > 100) {
        s_status.progress_pct = 100;
    }
    ota_unlock();
}

esp_err_t ota_update_manager_get_status(ota_update_status_t *out_status)
{
    if (out_status == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ota_lock();
    memcpy(out_status, &s_status, sizeof(*out_status));
    ota_unlock();
    return ESP_OK;
}

static esp_err_t ota_publish_progress(void)
{
    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    ota_update_status_t status;
    ota_update_manager_get_status(&status);

    char payload[320];
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"debug_type\":\"OTA_PROGRESS\","
                           "\"state\":\"OTA_UPDATE\","
                           "\"phase\":\"%s\","
                           "\"progress_pct\":%ld,"
                           "\"bytes_written\":%ld,"
                           "\"total_size\":%ld,"
                           "\"ts_ms\":%lld"
                           "}",
                           ota_update_manager_phase_to_string(status.phase),
                           (long)status.progress_pct,
                           (long)status.bytes_written,
                           (long)status.total_size,
                           (long long)ota_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}

static esp_err_t ota_publish_result(const char *result,
                                    const char *next_state,
                                    const char *target_version)
{
    if (!mqtt_manager_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }

    char payload[384];
    int written = snprintf(payload,
                           sizeof(payload),
                           "{"
                           "\"debug_type\":\"OTA_RESULT\","
                           "\"state\":\"OTA_UPDATE\","
                           "\"result\":\"%s\","
                           "\"next_state\":\"%s\","
                           "\"next_boot_target\":\"PROVISIONING\","
                           "\"firmware_version_target\":\"%s\","
                           "\"ts_ms\":%lld"
                           "}",
                           result != NULL ? result : "FAILED",
                           next_state != NULL ? next_state : "PROVISIONING",
                           target_version != NULL ? target_version : "",
                           (long long)ota_now_ms());

    if (written <= 0 || written >= (int)sizeof(payload)) {
        return ESP_ERR_INVALID_SIZE;
    }

    return mqtt_manager_publish_debug_json(payload);
}

static bool ota_constant_time_equal(const char *left, const char *right)
{
    if (left == NULL || right == NULL) {
        return false;
    }

    size_t left_len = strlen(left);
    size_t right_len = strlen(right);
    size_t max_len = left_len > right_len ? left_len : right_len;
    unsigned int difference = (unsigned int)(left_len ^ right_len);

    for (size_t i = 0; i < max_len; i++) {
        unsigned char a = i < left_len ? (unsigned char)left[i] : 0;
        unsigned char b = i < right_len ? (unsigned char)right[i] : 0;
        difference |= (unsigned int)(a ^ b);
    }

    return difference == 0;
}

static bool ota_extract_login_key(const char *body, char *out_key, size_t out_len)
{
    if (body == NULL || out_key == NULL || out_len == 0) {
        return false;
    }

    cJSON *root = cJSON_Parse(body);
    if (root != NULL) {
        cJSON *key = cJSON_GetObjectItemCaseSensitive(root, "key");
        if (cJSON_IsString(key) && key->valuestring != NULL) {
            strncpy(out_key, key->valuestring, out_len - 1);
            out_key[out_len - 1] = '\0';
            cJSON_Delete(root);
            return true;
        }
        cJSON_Delete(root);
    }

    const char *prefix = strstr(body, "key=");
    if (prefix == NULL) {
        return false;
    }

    prefix += 4;
    size_t length = strcspn(prefix, "&");
    if (length >= out_len) {
        length = out_len - 1;
    }

    memcpy(out_key, prefix, length);
    out_key[length] = '\0';
    return true;
}

static bool ota_authorized(httpd_req_t *req)
{
    char authorization[96] = {0};
    if (httpd_req_get_hdr_value_str(req,
                                    "Authorization",
                                    authorization,
                                    sizeof(authorization)) != ESP_OK) {
        return false;
    }

    const char bearer_prefix[] = "Bearer ";
    if (strncmp(authorization,
                bearer_prefix,
                sizeof(bearer_prefix) - 1) != 0) {
        return false;
    }

    const char *token = authorization + sizeof(bearer_prefix) - 1;
    return s_session_token[0] != '\0' &&
           ota_now_ms() <= s_session_expires_at_ms &&
           ota_constant_time_equal(token, s_session_token);
}

static void ota_clear_session(void)
{
    memset(s_session_token, 0, sizeof(s_session_token));
    s_session_expires_at_ms = 0;
}

static esp_err_t ota_save_failure(int32_t error_id,
                                  const char *failed_phase,
                                  int32_t bytes_written)
{
    memset(&s_metadata, 0, sizeof(s_metadata));
    s_metadata.force_provisioning = false;
    strncpy(s_metadata.last_result,
            "FAILED",
            sizeof(s_metadata.last_result) - 1);
    s_metadata.last_error_id = error_id;
    s_metadata.last_bytes_written = bytes_written;
    strncpy(s_metadata.last_failed_phase,
            failed_phase != NULL ? failed_phase : "UNKNOWN",
            sizeof(s_metadata.last_failed_phase) - 1);

    esp_err_t metadata_err = config_store_save_ota_metadata(&s_metadata);

    ota_lock();
    s_status.phase = OTA_PHASE_FAILED;
    s_status.last_error_id = error_id;
    strncpy(s_status.last_result,
            "FAILED",
            sizeof(s_status.last_result) - 1);
    strncpy(s_status.failed_phase,
            s_metadata.last_failed_phase,
            sizeof(s_status.failed_phase) - 1);
    ota_unlock();

    ESP_LOGE(TAG,
             "OTA failed phase=%s error_id=%ld bytes=%ld",
             s_metadata.last_failed_phase,
             (long)error_id,
             (long)bytes_written);

    ota_publish_result("FAILED", "PROVISIONING", "");
    return metadata_err;
}

static esp_err_t update_page_get_handler(httpd_req_t *req)
{
    static const char html[] =
        "<!doctype html><html><head>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>ResQ OTA Update</title>"
        "<style>"
        "body{font-family:Arial;margin:0;padding:24px;background:#f4f7fb}"
        "main{max-width:520px;margin:auto;background:white;padding:22px;border-radius:12px}"
        "input,button{width:100%;box-sizing:border-box;padding:11px;margin-top:10px}"
        "button{background:#0b63ce;color:white;border:0;border-radius:7px}"
        "pre{white-space:pre-wrap;background:#eef3f8;padding:12px;border-radius:7px}"
        "</style></head><body><main>"
        "<h2>ResQ Firmware Update</h2>"
        "<p>Select an ESP-IDF application binary. The device will reboot after verification.</p>"
        "<input id='key' type='password' placeholder='OTA access key'>"
        "<input id='file' type='file' accept='.bin,application/octet-stream'>"
        "<button id='upload'>Authenticate and Upload</button>"
        "<pre id='status'>Idle</pre>"
        "<script>"
        "const status=document.getElementById('status');"
        "document.getElementById('upload').onclick=async()=>{"
        "const file=document.getElementById('file').files[0];"
        "if(!file){status.textContent='Select a firmware .bin file.';return;}"
        "status.textContent='Authenticating...';"
        "try{"
        "const login=await fetch('/update/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:document.getElementById('key').value})});"
        "const loginData=await login.json();"
        "if(!login.ok)throw new Error(loginData.error||'Authentication failed');"
        "status.textContent='Uploading '+file.size+' bytes...';"
        "const upload=await fetch('/update/upload',{method:'POST',headers:{'Authorization':'Bearer '+loginData.token,'Content-Type':'application/octet-stream'},body:file});"
        "const text=await upload.text();"
        "if(!upload.ok)throw new Error(text||'Upload failed');"
        "status.textContent='Update verified. Device is rebooting into provisioning.\\n'+text;"
        "}catch(error){status.textContent='Error: '+error.message;}};"
        "</script></main></body></html>";

    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t login_post_handler(httpd_req_t *req)
{
    if (req->content_len <= 0 ||
        req->content_len >= OTA_LOGIN_BODY_MAX_LEN) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid login body");
        return ESP_FAIL;
    }

    ota_set_phase(OTA_PHASE_AUTHENTICATING);

    char body[OTA_LOGIN_BODY_MAX_LEN] = {0};
    int received = httpd_req_recv(req, body, req->content_len);
    if (received <= 0) {
        ota_set_phase(OTA_PHASE_IDLE);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Login body read failed");
        return ESP_FAIL;
    }
    body[received] = '\0';

    char provided_key[96] = {0};
    bool has_key = ota_extract_login_key(body,
                                         provided_key,
                                         sizeof(provided_key));

    if (!has_key ||
        CONFIG_RESQ_OTA_ACCESS_KEY[0] == '\0' ||
        !ota_constant_time_equal(provided_key, CONFIG_RESQ_OTA_ACCESS_KEY)) {
        ota_set_phase(OTA_PHASE_IDLE);
        ota_save_failure(OTA_ERROR_AUTH_FAILED, "AUTHENTICATING", 0);
        ota_lock();
        s_status.phase = OTA_PHASE_IDLE;
        ota_unlock();
        httpd_resp_set_status(req, "401 Unauthorized");
        httpd_resp_set_type(req, "application/json");
        httpd_resp_sendstr(req, "{\"ok\":false,\"error\":\"unauthorized\"}");
        return ESP_FAIL;
    }

    uint64_t random_value =
        ((uint64_t)esp_random() << 32) | (uint64_t)esp_random();
    snprintf(s_session_token,
             sizeof(s_session_token),
             "%016llx%016llx",
             (unsigned long long)random_value,
             (unsigned long long)(random_value ^ (uint64_t)ota_now_ms()));
    s_session_expires_at_ms =
        ota_now_ms() + ((int64_t)CONFIG_RESQ_OTA_TOKEN_TTL_SECONDS * 1000);

    ota_set_phase(OTA_PHASE_IDLE);

    char response[128];
    snprintf(response,
             sizeof(response),
             "{\"ok\":true,\"token\":\"%s\",\"expires_at_ms\":%lld}",
             s_session_token,
             (long long)s_session_expires_at_ms);

    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, response);
}

static esp_err_t status_get_handler(httpd_req_t *req)
{
    ota_update_status_t status;
    ota_update_manager_get_status(&status);

    char response[384];
    snprintf(response,
             sizeof(response),
             "{"
             "\"phase\":\"%s\","
             "\"progress_pct\":%ld,"
             "\"bytes_written\":%ld,"
             "\"total_size\":%ld,"
             "\"last_result\":\"%s\","
             "\"last_error_id\":%ld,"
             "\"target_version\":\"%s\""
             "}",
             ota_update_manager_phase_to_string(status.phase),
             (long)status.progress_pct,
             (long)status.bytes_written,
             (long)status.total_size,
             status.last_result,
             (long)status.last_error_id,
             status.target_version);

    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, response);
}

static esp_err_t logs_get_handler(httpd_req_t *req)
{
    ota_metadata_t metadata;
    esp_err_t err = config_store_load_ota_metadata(&metadata);
    if (err != ESP_OK) {
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Failed to load OTA metadata");
        return err;
    }

    char response[384];
    snprintf(response,
             sizeof(response),
             "{"
             "\"last_ota_result\":\"%s\","
             "\"last_ota_version\":\"%s\","
             "\"last_ota_error_id\":%ld,"
             "\"last_ota_bytes_written\":%ld,"
             "\"last_ota_failed_phase\":\"%s\""
             "}",
             metadata.last_result,
             metadata.last_version,
             (long)metadata.last_error_id,
             (long)metadata.last_bytes_written,
             metadata.last_failed_phase);

    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, response);
}

static esp_err_t upload_post_handler(httpd_req_t *req)
{
    if (!ota_authorized(req)) {
        httpd_resp_set_status(req, "401 Unauthorized");
        httpd_resp_sendstr(req, "Missing, invalid, or expired OTA token");
        return ESP_FAIL;
    }
    ota_clear_session();

    if (req->content_len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty firmware image");
        return ESP_FAIL;
    }

    ota_update_status_t current;
    ota_update_manager_get_status(&current);
    if (current.phase != OTA_PHASE_IDLE) {
        httpd_resp_set_status(req, "409 Conflict");
        httpd_resp_sendstr(req, "Another OTA operation is active");
        return ESP_ERR_INVALID_STATE;
    }

    ota_lock();
    memset(&s_status, 0, sizeof(s_status));
    s_status.phase = OTA_PHASE_RECEIVING;
    s_status.total_size = req->content_len;
    strncpy(s_status.last_result,
            s_metadata.last_result,
            sizeof(s_status.last_result) - 1);
    ota_unlock();

    ota_publish_progress();

    const esp_partition_t *running_partition =
        esp_ota_get_running_partition();
    const esp_partition_t *update_partition =
        esp_ota_get_next_update_partition(NULL);

    if (update_partition == NULL ||
        update_partition == running_partition ||
        req->content_len > update_partition->size) {
        ota_save_failure(OTA_ERROR_NO_UPDATE_PARTITION,
                         "RECEIVING",
                         0);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "No suitable OTA partition");
        return ESP_FAIL;
    }

    esp_ota_handle_t ota_handle = 0;
    esp_err_t err = esp_ota_begin(update_partition,
                                  req->content_len,
                                  &ota_handle);
    if (err != ESP_OK) {
        ota_save_failure(OTA_ERROR_BEGIN_FAILED, "RECEIVING", 0);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "OTA begin failed");
        return err;
    }

    char buffer[OTA_UPLOAD_BUFFER_SIZE];
    int32_t bytes_written = 0;
    int32_t last_published_pct = -OTA_PROGRESS_STEP_PCT;
    ota_set_phase(OTA_PHASE_WRITING);

    while (bytes_written < req->content_len) {
        int remaining = req->content_len - bytes_written;
        int requested = remaining < (int)sizeof(buffer)
            ? remaining
            : (int)sizeof(buffer);
        int received = httpd_req_recv(req, buffer, requested);

        if (received == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }
        if (received <= 0) {
            esp_ota_abort(ota_handle);
            ota_save_failure(OTA_ERROR_RECEIVE_FAILED,
                             "RECEIVING",
                             bytes_written);
            httpd_resp_send_err(req,
                                HTTPD_500_INTERNAL_SERVER_ERROR,
                                "Firmware receive failed");
            return ESP_FAIL;
        }

        err = esp_ota_write(ota_handle, buffer, received);
        if (err != ESP_OK) {
            esp_ota_abort(ota_handle);
            ota_save_failure(OTA_ERROR_WRITE_FAILED,
                             "WRITING",
                             bytes_written);
            httpd_resp_send_err(req,
                                HTTPD_500_INTERNAL_SERVER_ERROR,
                                "Firmware write failed");
            return err;
        }

        bytes_written += received;
        ota_set_progress(bytes_written, req->content_len);

        ota_update_status_t progress;
        ota_update_manager_get_status(&progress);
        if (progress.progress_pct >=
            last_published_pct + OTA_PROGRESS_STEP_PCT) {
            ota_publish_progress();
            last_published_pct = progress.progress_pct;
        }
    }

    ota_set_phase(OTA_PHASE_VERIFYING);
    ota_publish_progress();

    err = esp_ota_end(ota_handle);
    if (err != ESP_OK) {
        ota_save_failure(OTA_ERROR_VERIFY_FAILED,
                         "VERIFYING",
                         bytes_written);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Firmware verification failed");
        return err;
    }

    esp_app_desc_t app_description = {0};
    err = esp_ota_get_partition_description(update_partition,
                                             &app_description);
    if (err != ESP_OK) {
        ota_save_failure(OTA_ERROR_VERIFY_FAILED,
                         "VERIFYING",
                         bytes_written);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Firmware description invalid");
        return err;
    }

    ota_set_phase(OTA_PHASE_SET_BOOT_PARTITION);
    ota_publish_progress();

    err = esp_ota_set_boot_partition(update_partition);
    if (err != ESP_OK) {
        ota_save_failure(OTA_ERROR_SET_BOOT_FAILED,
                         "SET_BOOT_PARTITION",
                         bytes_written);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Failed to select OTA boot partition");
        return err;
    }

    memset(&s_metadata, 0, sizeof(s_metadata));
    s_metadata.force_provisioning = true;
    strncpy(s_metadata.last_result,
            "SUCCESS",
            sizeof(s_metadata.last_result) - 1);
    strncpy(s_metadata.last_version,
            app_description.version,
            sizeof(s_metadata.last_version) - 1);
    s_metadata.last_error_id = OTA_ERROR_NONE;
    s_metadata.last_bytes_written = bytes_written;

    err = config_store_save_ota_metadata(&s_metadata);
    if (err != ESP_OK) {
        esp_ota_set_boot_partition(running_partition);
        ota_save_failure(OTA_ERROR_METADATA_SAVE_FAILED,
                         "SET_BOOT_PARTITION",
                         bytes_written);
        httpd_resp_send_err(req,
                            HTTPD_500_INTERNAL_SERVER_ERROR,
                            "Failed to save OTA metadata");
        return err;
    }

    ota_lock();
    strncpy(s_status.last_result,
            "SUCCESS",
            sizeof(s_status.last_result) - 1);
    strncpy(s_status.target_version,
            app_description.version,
            sizeof(s_status.target_version) - 1);
    s_status.last_error_id = OTA_ERROR_NONE;
    s_status.progress_pct = 100;
    ota_unlock();

    ota_publish_result("SUCCESS",
                       "RESETTING",
                       app_description.version);

    httpd_resp_set_type(req, "application/json");
    esp_err_t response_err = httpd_resp_sendstr(
        req,
        "{\"ok\":true,\"result\":\"SUCCESS\",\"next_state\":\"RESETTING\",\"next_boot_target\":\"PROVISIONING\"}");

    ota_set_phase(OTA_PHASE_SUCCESS_REBOOTING);
    ESP_LOGI(TAG,
             "OTA verified version=%s bytes=%ld; waiting for RESETTING state",
             app_description.version,
             (long)bytes_written);

    return response_err;
}

static const httpd_uri_t s_update_page_uri = {
    .uri = "/update",
    .method = HTTP_GET,
    .handler = update_page_get_handler,
    .user_ctx = NULL,
};

static const httpd_uri_t s_login_uri = {
    .uri = "/update/login",
    .method = HTTP_POST,
    .handler = login_post_handler,
    .user_ctx = NULL,
};

static const httpd_uri_t s_upload_uri = {
    .uri = "/update/upload",
    .method = HTTP_POST,
    .handler = upload_post_handler,
    .user_ctx = NULL,
};

static const httpd_uri_t s_status_uri = {
    .uri = "/update/status",
    .method = HTTP_GET,
    .handler = status_get_handler,
    .user_ctx = NULL,
};

static const httpd_uri_t s_logs_uri = {
    .uri = "/update/logs",
    .method = HTTP_GET,
    .handler = logs_get_handler,
    .user_ctx = NULL,
};

esp_err_t ota_update_manager_init(void)
{
    if (s_status_mutex == NULL) {
        s_status_mutex = xSemaphoreCreateMutex();
        if (s_status_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    memset(&s_status, 0, sizeof(s_status));
    s_status.phase = OTA_PHASE_IDLE;

    esp_err_t err = config_store_load_ota_metadata(&s_metadata);
    if (err != ESP_OK) {
        return err;
    }

    strncpy(s_status.last_result,
            s_metadata.last_result,
            sizeof(s_status.last_result) - 1);
    strncpy(s_status.target_version,
            s_metadata.last_version,
            sizeof(s_status.target_version) - 1);
    strncpy(s_status.failed_phase,
            s_metadata.last_failed_phase,
            sizeof(s_status.failed_phase) - 1);
    s_status.last_error_id = s_metadata.last_error_id;
    s_status.bytes_written = s_metadata.last_bytes_written;

    return ESP_OK;
}

esp_err_t ota_update_manager_register_http_handlers(httpd_handle_t server)
{
    if (server == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_registered_server == server) {
        return ESP_OK;
    }

    esp_err_t err = httpd_register_uri_handler(server, &s_update_page_uri);
    if (err != ESP_OK) return err;
    err = httpd_register_uri_handler(server, &s_login_uri);
    if (err != ESP_OK) return err;
    err = httpd_register_uri_handler(server, &s_upload_uri);
    if (err != ESP_OK) return err;
    err = httpd_register_uri_handler(server, &s_status_uri);
    if (err != ESP_OK) return err;
    err = httpd_register_uri_handler(server, &s_logs_uri);
    if (err != ESP_OK) return err;

    s_registered_server = server;
    ESP_LOGI(TAG, "OTA routes registered under /update");
    return ESP_OK;
}

void ota_update_manager_http_server_stopped(httpd_handle_t server)
{
    if (s_registered_server == server) {
        s_registered_server = NULL;
    }
    ota_clear_session();
}

bool ota_update_manager_has_pending_request(void)
{
    ota_update_status_t status;
    ota_update_manager_get_status(&status);

    return status.phase == OTA_PHASE_RECEIVING ||
           status.phase == OTA_PHASE_WRITING ||
           status.phase == OTA_PHASE_VERIFYING ||
           status.phase == OTA_PHASE_SET_BOOT_PARTITION ||
           status.phase == OTA_PHASE_SUCCESS_REBOOTING ||
           status.phase == OTA_PHASE_FAILED;
}

resq_state_t ota_update_manager_run(void)
{
    ota_update_status_t status;
    ota_update_manager_get_status(&status);

    if (status.phase == OTA_PHASE_SUCCESS_REBOOTING) {
        return RESQ_STATE_RESETTING;
    }

    if (status.phase == OTA_PHASE_FAILED) {
        ota_set_phase(OTA_PHASE_IDLE);
        return RESQ_STATE_PROVISIONING;
    }

    return RESQ_STATE_OTA_UPDATE;
}
