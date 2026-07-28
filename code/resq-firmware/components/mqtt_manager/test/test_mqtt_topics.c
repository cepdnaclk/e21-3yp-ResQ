#include <string.h>
#include <stdio.h>

#include "mqtt_manager.h"
#include "mqtt_topics.h"
#include "unity.h"

static void prepare_command_fragment_test(void) {
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_reassembly_for_test();
  mqtt_manager_reset_command_cache_for_test();
}

static void assert_command_queue_empty(void) {
  resq_mqtt_command_t command = {0};
  TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT,
                    mqtt_manager_wait_for_command(&command, 0));
}

TEST_CASE("MQTT topic builder creates canonical ResQ topics", "[mqtt]") {
  char topic[64];
  TEST_ASSERT_EQUAL(ESP_OK, resq_mqtt_build_topic("node-1",
                                                  RESQ_SUFFIX_CMD_SESSION_START,
                                                  topic, sizeof(topic)));
  TEST_ASSERT_EQUAL_STRING("resq/node-1/cmd/session/start", topic);
}

TEST_CASE("MQTT topic builder rejects invalid and short buffers", "[mqtt]") {
  char topic[8];
  TEST_ASSERT_EQUAL(
      ESP_ERR_INVALID_ARG,
      resq_mqtt_build_topic(NULL, "status", topic, sizeof(topic)));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    resq_mqtt_build_topic("", "status", topic, sizeof(topic)));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    resq_mqtt_build_topic("node", "", topic, sizeof(topic)));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    resq_mqtt_build_topic("node", "status", NULL, 0));
  TEST_ASSERT_EQUAL(
      ESP_ERR_INVALID_SIZE,
      resq_mqtt_build_topic("node", "status", topic, sizeof(topic)));
}

TEST_CASE(
    "MQTT fragmented command reassembles once with empty continuation topic",
    "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  const char *part1 = "{\"request_id\":\"req-1\",";
  const char *part2 = "\"hall_delta\":675}";
  int part1_len = strlen(part1);
  int part2_len = strlen(part2);
  int total_len = part1_len + part2_len;
  resq_mqtt_command_t command = {0};

  prepare_command_fragment_test();

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), part1, part1_len, total_len, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT,
                    mqtt_manager_wait_for_command(&command, 0));

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len, part1_len));
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_wait_for_command(&command, 0));
  TEST_ASSERT_EQUAL_STRING(topic, command.topic);
  TEST_ASSERT_EQUAL_STRING("{\"request_id\":\"req-1\",\"hall_delta\":675}",
                           command.payload);
  TEST_ASSERT_EQUAL(total_len, command.payload_len);
  TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT,
                    mqtt_manager_wait_for_command(&command, 0));
}

TEST_CASE("MQTT malformed fragment resets partial command", "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  const char *part1 = "{\"request_id\":\"req-1\",";
  const char *part2 = "\"hall_delta\":675}";
  const char *recovered =
      "{\"request_id\":\"req-recovered\",\"hall_delta\":675}";
  int part1_len = strlen(part1);
  int part2_len = strlen(part2);
  int total_len = part1_len + part2_len;
  resq_mqtt_command_t command = {0};

  prepare_command_fragment_test();

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), part1, part1_len, total_len, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len, part1_len + 1));
  assert_command_queue_empty();

  int recovered_len = strlen(recovered);
  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), recovered, recovered_len,
                        recovered_len, 0));
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_wait_for_command(&command, 0));
  TEST_ASSERT_EQUAL_STRING(recovered, command.payload);
  assert_command_queue_empty();
}

TEST_CASE("MQTT oversized command is rejected without queueing", "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  char byte = '{';

  prepare_command_fragment_test();

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), &byte, 1,
                        MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN, 0));
  assert_command_queue_empty();
}

TEST_CASE("MQTT continuation invariants reject and reset partial state",
          "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  const char *part1 = "{\"request_id\":\"req-invariants\",";
  const char *part2 = "\"hall_delta\":675}";
  int part1_len = strlen(part1);
  int part2_len = strlen(part2);
  int total_len = part1_len + part2_len;

  prepare_command_fragment_test();
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len, part1_len));
  assert_command_queue_empty();

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), part1, part1_len, total_len, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len,
                        part1_len - 1));
  assert_command_queue_empty();

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), part1, part1_len, total_len, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len + 1, part1_len));
  assert_command_queue_empty();
}

TEST_CASE("MQTT impossible fragment arguments remain invalid arguments",
          "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  const char byte = '{';

  prepare_command_fragment_test();
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), &byte, 1, -1, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, -1, &byte, 1, 1, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), NULL, 1, 1, 0));
  assert_command_queue_empty();
}

TEST_CASE("MQTT duplicate pending command is queued once", "[mqtt][dedup]") {
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_cache_for_test();
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_NEW,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "same-request"));
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_DUPLICATE_PENDING,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "same-request"));
}

TEST_CASE("MQTT cache lock timeout never returns new", "[mqtt][dedup]") {
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_cache_for_test();
  TEST_ASSERT_EQUAL(
      ESP_OK, mqtt_manager_set_cache_lock_failure_for_test(true));
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_BUSY,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "lock-timeout"));
  TEST_ASSERT_EQUAL(
      ESP_OK, mqtt_manager_set_cache_lock_failure_for_test(false));
}

TEST_CASE("MQTT full cache does not evict pending commands",
          "[mqtt][dedup]") {
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_cache_for_test();
  char request_id[24];
  for (int i = 0; i < 8; ++i) {
    snprintf(request_id, sizeof(request_id), "pending-%d", i);
    TEST_ASSERT_EQUAL(
        COMMAND_CACHE_NEW,
        mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                          request_id));
  }
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_BUSY,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "pending-overflow"));
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_DUPLICATE_PENDING,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "pending-0"));
}

TEST_CASE("MQTT same request ID on different topics remains distinct",
          "[mqtt][dedup]") {
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_cache_for_test();
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_NEW,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/start",
                                        "shared-id"));
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_NEW,
      mqtt_manager_cache_check_for_test("resq/node/cmd/session/stop",
                                        "shared-id"));
}

TEST_CASE("MQTT response completion updates matching cache entry",
          "[mqtt][dedup]") {
  const char *topic = "resq/node/cmd/session/start";
  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_cache_for_test();
  TEST_ASSERT_EQUAL(COMMAND_CACHE_NEW,
                    mqtt_manager_cache_check_for_test(topic, "complete-id"));
  TEST_ASSERT_EQUAL(
      ESP_OK, mqtt_manager_cache_command_response(
                  topic, "complete-id", RESQ_SUFFIX_DEBUG, "{\"ok\":true}"));
  TEST_ASSERT_EQUAL(
      COMMAND_CACHE_DUPLICATE_COMPLETE,
      mqtt_manager_cache_check_for_test(topic, "complete-id"));
  TEST_ASSERT_EQUAL(
      ESP_ERR_NOT_FOUND,
      mqtt_manager_cache_command_response(
          topic, "missing-id", RESQ_SUFFIX_DEBUG, "{\"ok\":true}"));
}
