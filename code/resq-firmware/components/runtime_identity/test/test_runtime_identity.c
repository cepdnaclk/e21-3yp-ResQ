#include <string.h>

#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "runtime_identity.h"
#include "unity.h"

#define CONCURRENT_TASKS 4
#define CONCURRENT_CALLS 64

static bool is_lower_hex_boot_id(const char *boot_id) {
  if (boot_id == NULL || strlen(boot_id) != RUNTIME_IDENTITY_BOOT_ID_LEN) {
    return false;
  }
  for (size_t i = 0; i < RUNTIME_IDENTITY_BOOT_ID_LEN; ++i) {
    char c = boot_id[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
      return false;
    }
  }
  return true;
}

TEST_CASE("runtime identity boot id is sixteen lowercase hex characters",
          "[runtime_identity]") {
  TEST_ASSERT_EQUAL(ESP_OK, runtime_identity_init());
  TEST_ASSERT_TRUE(is_lower_hex_boot_id(runtime_identity_boot_id()));
}

TEST_CASE("runtime identity boot id is stable during one boot",
          "[runtime_identity]") {
  TEST_ASSERT_EQUAL(ESP_OK, runtime_identity_init());
  const char *first = runtime_identity_boot_id();
  const char *second = runtime_identity_boot_id();
  TEST_ASSERT_EQUAL_STRING(first, second);
}

TEST_CASE("runtime identity state sequence starts at one and increases",
          "[runtime_identity]") {
  TEST_ASSERT_EQUAL(ESP_OK, runtime_identity_init());
  uint32_t before = runtime_identity_current_state_seq();
  uint32_t first = runtime_identity_next_state_seq();
  uint32_t second = runtime_identity_next_state_seq();
  TEST_ASSERT_EQUAL(before + 1, first);
  TEST_ASSERT_EQUAL(first + 1, second);
}

typedef struct {
  uint32_t values[CONCURRENT_CALLS];
  TaskHandle_t parent;
} seq_task_context_t;

static void collect_sequences_task(void *arg) {
  seq_task_context_t *ctx = (seq_task_context_t *)arg;
  for (int i = 0; i < CONCURRENT_CALLS; ++i) {
    ctx->values[i] = runtime_identity_next_state_seq();
  }
  xTaskNotifyGive(ctx->parent);
  vTaskDelete(NULL);
}

TEST_CASE("runtime identity concurrent sequence calls are unique",
          "[runtime_identity]") {
  seq_task_context_t contexts[CONCURRENT_TASKS] = {0};
  TaskHandle_t parent = xTaskGetCurrentTaskHandle();
  for (int i = 0; i < CONCURRENT_TASKS; ++i) {
    contexts[i].parent = parent;
    TEST_ASSERT_EQUAL(pdPASS,
                      xTaskCreate(collect_sequences_task, "seq_test", 2048,
                                  &contexts[i], 4, NULL));
  }
  for (int i = 0; i < CONCURRENT_TASKS; ++i) {
    TEST_ASSERT_GREATER_THAN(0, ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000)));
  }
  for (int i = 0; i < CONCURRENT_TASKS; ++i) {
    for (int j = 0; j < CONCURRENT_CALLS; ++j) {
      TEST_ASSERT_GREATER_THAN_UINT32(0, contexts[i].values[j]);
      for (int ii = i; ii < CONCURRENT_TASKS; ++ii) {
        int start = (ii == i) ? j + 1 : 0;
        for (int jj = start; jj < CONCURRENT_CALLS; ++jj) {
          TEST_ASSERT_NOT_EQUAL(contexts[i].values[j], contexts[ii].values[jj]);
        }
      }
    }
  }
}

TEST_CASE("runtime identity adds ordering fields to json",
          "[runtime_identity]") {
  cJSON *root = cJSON_CreateObject();
  TEST_ASSERT_NOT_NULL(root);
  cJSON_AddNumberToObject(root, "event_id", 4002);
  TEST_ASSERT_EQUAL(ESP_OK, runtime_identity_add_to_json(root));
  TEST_ASSERT_TRUE(runtime_identity_has_valid_ordering(root));
  TEST_ASSERT_NOT_NULL(cJSON_GetObjectItemCaseSensitive(root, "event_id"));
  cJSON_Delete(root);
}
