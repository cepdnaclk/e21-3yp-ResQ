#include "runtime_helpers.h"
#include "unity.h"

#include <string.h>

static void assert_payload_contains(const char *payload, const char *field)
{
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(payload, field), field);
}

TEST_CASE("Request ID parser accepts command_id and request_id", "[mqtt]")
{
    char id[32];
    TEST_ASSERT_EQUAL(ESP_OK,
                      resq_command_extract_request_id(
                          "{\"command_id\":\"cmd-1\"}", id, sizeof(id)));
    TEST_ASSERT_EQUAL_STRING("cmd-1", id);
    TEST_ASSERT_EQUAL(ESP_OK,
                      resq_command_extract_request_id(
                          "{\"request_id\":\"req-2\"}", id, sizeof(id)));
    TEST_ASSERT_EQUAL_STRING("req-2", id);
}

TEST_CASE("Request ID parser rejects malformed missing and oversized IDs", "[mqtt]")
{
    char id[8];
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_command_extract_request_id(NULL, id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      resq_command_extract_request_id("{bad", id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      resq_command_extract_request_id("{}", id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_SIZE,
                      resq_command_extract_request_id(
                          "{\"command_id\":\"too-long-id\"}", id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_command_extract_request_id(
                          "{\"request_id\":\"bad\\\"id\"}", id, sizeof(id)));
}

TEST_CASE("Idle debug payload contains raw and converted direct snapshot fields", "[debug]")
{
    network_config_t network = {0};
    sensor_raw_sample_t raw = {
        .pressure_raw = {1100, 1200, 8300000},
        .pressure_read_valid = {true, true, true},
        .hall_raw = 1250,
        .hall_read_valid = true,
        .pressure_saturation_mask = 0x04u,
        .timestamp_ms = 777,
    };
    sensor_converted_sample_t converted = {
        .pressure_kpa = {1.0f, 2.0f, 99.0f},
        .pressure_kpa_channel_valid = {true, true, false},
        .pressure_kpa_valid = false,
        .pressure_saturation_mask = 0x04u,
        .hall_mm = 25.0f,
        .hall_progress = 0.5f,
        .hall_mm_valid = true,
        .timestamp_ms = 777,
    };
    char payload[960];

    TEST_ASSERT_EQUAL(ESP_OK, runtime_helpers_build_direct_debug_payload(
                                  &network,
                                  &raw,
                                  &converted,
                                  true,
                                  true,
                                  true,
                                  payload,
                                  sizeof(payload)));

    assert_payload_contains(payload, "\"source\":\"DIRECT_SENSOR_SNAPSHOT\"");
    assert_payload_contains(payload, "\"pressure_0_raw\":1100");
    assert_payload_contains(payload, "\"pressure_1_raw\":1200");
    assert_payload_contains(payload, "\"pressure_2_raw\":8300000");
    assert_payload_contains(payload, "\"hall_raw\":1250");
    assert_payload_contains(payload, "\"pressure_0_kpa\":1.000");
    assert_payload_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_payload_contains(payload, "\"pressure_1_kpa\":2.000");
    assert_payload_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_payload_contains(payload, "\"pressure_2_kpa\":0.000");
    assert_payload_contains(payload, "\"pressure_2_kpa_valid\":false");
    assert_payload_contains(payload, "\"pressure_kpa_valid\":false");
    assert_payload_contains(payload, "\"hall_mm\":25.000");
    assert_payload_contains(payload, "\"hall_progress\":0.500");
    assert_payload_contains(payload, "\"hall_mm_valid\":true");
    assert_payload_contains(payload, "\"pressure_saturation_mask\":4");
    assert_payload_contains(payload, "\"ts_ms\":777");
}

TEST_CASE("Idle debug payload emits finite zero for invalid converted values", "[debug]")
{
    network_config_t network = {0};
    sensor_raw_sample_t raw = {
        .pressure_raw = {1100, 1200, 1300},
        .pressure_read_valid = {true, true, true},
        .hall_raw = 0,
        .hall_read_valid = false,
        .timestamp_ms = 778,
    };
    sensor_converted_sample_t converted = {
        .pressure_kpa = {1.0f, 2.0f, 3.0f},
        .pressure_kpa_channel_valid = {false, false, false},
        .hall_mm = 25.0f,
        .hall_progress = 0.5f,
        .hall_mm_valid = false,
    };
    char payload[960];

    TEST_ASSERT_EQUAL(ESP_OK, runtime_helpers_build_direct_debug_payload(
                                  &network,
                                  &raw,
                                  &converted,
                                  true,
                                  false,
                                  false,
                                  payload,
                                  sizeof(payload)));

    assert_payload_contains(payload, "\"pressure_0_kpa\":0.000");
    assert_payload_contains(payload, "\"pressure_1_kpa\":0.000");
    assert_payload_contains(payload, "\"pressure_2_kpa\":0.000");
    assert_payload_contains(payload, "\"hall_mm\":0.000");
    assert_payload_contains(payload, "\"hall_progress\":0.000");
    assert_payload_contains(payload, "\"hall_mm_valid\":false");
    TEST_ASSERT_NULL(strstr(payload, "nan"));
    TEST_ASSERT_NULL(strstr(payload, "inf"));
}
