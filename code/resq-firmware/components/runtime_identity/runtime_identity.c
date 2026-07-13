#include "runtime_identity.h"

#include <stdio.h>
#include <string.h>

#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"

static char s_boot_id[RUNTIME_IDENTITY_BOOT_ID_LEN + 1];
static portMUX_TYPE s_seq_mux = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_state_seq;
static bool s_initialized;

static bool boot_id_is_valid(const char *boot_id) {
  if (boot_id == NULL) return false;
  for (size_t i = 0; i < RUNTIME_IDENTITY_BOOT_ID_LEN; ++i) {
    char c = boot_id[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
      return false;
    }
  }
  return boot_id[RUNTIME_IDENTITY_BOOT_ID_LEN] == '\0';
}

esp_err_t runtime_identity_init(void) {
  if (s_initialized) return ESP_OK;

  uint32_t high = esp_random();
  uint32_t low = esp_random();
  int written = snprintf(s_boot_id, sizeof(s_boot_id), "%08lx%08lx",
                         (unsigned long)high, (unsigned long)low);
  if (written != RUNTIME_IDENTITY_BOOT_ID_LEN || !boot_id_is_valid(s_boot_id)) {
    memset(s_boot_id, 0, sizeof(s_boot_id));
    return ESP_FAIL;
  }

  portENTER_CRITICAL(&s_seq_mux);
  s_state_seq = 0;
  portEXIT_CRITICAL(&s_seq_mux);
  s_initialized = true;
  return ESP_OK;
}

const char *runtime_identity_boot_id(void) {
  if (!s_initialized) {
    (void)runtime_identity_init();
  }
  return s_boot_id;
}

uint32_t runtime_identity_next_state_seq(void) {
  uint32_t next;
  portENTER_CRITICAL(&s_seq_mux);
  s_state_seq = (s_state_seq == UINT32_MAX) ? 1 : s_state_seq + 1;
  next = s_state_seq;
  portEXIT_CRITICAL(&s_seq_mux);
  return next;
}

uint32_t runtime_identity_current_state_seq(void) {
  uint32_t current;
  portENTER_CRITICAL(&s_seq_mux);
  current = s_state_seq;
  portEXIT_CRITICAL(&s_seq_mux);
  return current;
}

bool runtime_identity_has_valid_ordering(const cJSON *root) {
  if (root == NULL) return false;
  const cJSON *boot_id = cJSON_GetObjectItemCaseSensitive(root, "boot_id");
  const cJSON *state_seq = cJSON_GetObjectItemCaseSensitive(root, "state_seq");
  double seq = cJSON_IsNumber(state_seq) ? state_seq->valuedouble : 0.0;
  return cJSON_IsString(boot_id) && boot_id_is_valid(boot_id->valuestring) &&
         seq >= 1.0 && seq <= 4294967295.0 &&
         seq == (double)(uint32_t)seq;
}

esp_err_t runtime_identity_add_to_json(cJSON *root) {
  if (root == NULL) return ESP_ERR_INVALID_ARG;
  esp_err_t init_err = runtime_identity_init();
  if (init_err != ESP_OK) return init_err;

  cJSON_DeleteItemFromObjectCaseSensitive(root, "boot_id");
  cJSON_DeleteItemFromObjectCaseSensitive(root, "state_seq");
  if (cJSON_AddStringToObject(root, "boot_id", runtime_identity_boot_id()) ==
          NULL ||
      cJSON_AddNumberToObject(root, "state_seq",
                              runtime_identity_next_state_seq()) == NULL) {
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}

esp_err_t runtime_identity_ensure_json_payload(const char *json_payload,
                                               char **out_payload) {
  if (json_payload == NULL || out_payload == NULL) return ESP_ERR_INVALID_ARG;
  *out_payload = NULL;

  cJSON *root = cJSON_Parse(json_payload);
  if (root == NULL || !cJSON_IsObject(root)) {
    cJSON_Delete(root);
    return ESP_ERR_INVALID_ARG;
  }

  if (!runtime_identity_has_valid_ordering(root)) {
    esp_err_t err = runtime_identity_add_to_json(root);
    if (err != ESP_OK) {
      cJSON_Delete(root);
      return err;
    }
  }

  *out_payload = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return *out_payload == NULL ? ESP_ERR_NO_MEM : ESP_OK;
}
