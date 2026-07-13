#include <string.h>

#include "mqtt_manager.h"
#include "mqtt_topics.h"
#include "unity.h"

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

  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_reassembly_for_test();

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
  int part1_len = strlen(part1);
  int part2_len = strlen(part2);
  int total_len = part1_len + part2_len;
  resq_mqtt_command_t command = {0};

  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_reassembly_for_test();

  TEST_ASSERT_EQUAL(ESP_OK,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), part1, part1_len, total_len, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                    mqtt_manager_handle_command_fragment_for_test(
                        NULL, 0, part2, part2_len, total_len, part1_len + 1));
  TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT,
                    mqtt_manager_wait_for_command(&command, 0));
}

TEST_CASE("MQTT oversized command is rejected without queueing", "[mqtt]") {
  const char *topic = "resq/node-1/cmd/calibration/start";
  char byte = '{';
  resq_mqtt_command_t command = {0};

  TEST_ASSERT_EQUAL(ESP_OK, mqtt_manager_init());
  mqtt_manager_reset_command_reassembly_for_test();

  TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                    mqtt_manager_handle_command_fragment_for_test(
                        topic, strlen(topic), &byte, 1,
                        MQTT_MANAGER_COMMAND_PAYLOAD_MAX_LEN, 0));
  TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT,
                    mqtt_manager_wait_for_command(&command, 0));
}
