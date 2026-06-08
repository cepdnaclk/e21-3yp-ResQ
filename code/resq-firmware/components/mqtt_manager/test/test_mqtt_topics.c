#include "mqtt_topics.h"
#include "unity.h"

TEST_CASE("MQTT topic builder creates canonical ResQ topics", "[mqtt]")
{
    char topic[64];
    TEST_ASSERT_EQUAL(ESP_OK,
                      resq_mqtt_build_topic("node-1",
                                            RESQ_SUFFIX_CMD_SESSION_START,
                                            topic,
                                            sizeof(topic)));
    TEST_ASSERT_EQUAL_STRING("resq/node-1/cmd/session/start", topic);
}

TEST_CASE("MQTT topic builder rejects invalid and short buffers", "[mqtt]")
{
    char topic[8];
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_mqtt_build_topic(NULL, "status", topic, sizeof(topic)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_mqtt_build_topic("", "status", topic, sizeof(topic)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_mqtt_build_topic("node", "", topic, sizeof(topic)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_mqtt_build_topic("node", "status", NULL, 0));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_SIZE,
                      resq_mqtt_build_topic("node", "status", topic, sizeof(topic)));
}
