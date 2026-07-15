#include <string.h>

#include "telemetry_publisher.h"
#include "io_mode_manager.h"
#include "unity.h"

static void assert_contains(const char *payload, const char *field)
{
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(payload, field), field);
}

static void assert_not_contains(const char *payload, const char *field)
{
    TEST_ASSERT_NULL_MESSAGE(strstr(payload, field), field);
}

static cpr_metrics_snapshot_t base_snapshot(void)
{
    cpr_metrics_snapshot_t snap = {
        .depth_progress = 0.92f,
        .depth_mm = 46.0f,
        .rate_cpm = 108.0f,
        .pause_s = 0.25f,
        .total_compressions = 18,
        .valid_compressions = 15,
        .recoil_ok_count = 14,
        .incomplete_recoil_count = 3,
        .depth_ok = true,
        .pressure_balance_pct = 8.5f,
        .pressure_balance_reliable = true,
        .pressure_mode = CALIBRATION_PRESSURE_OPTIONAL,
        .pressure_valid = true,
        .hall_valid = true,
        .pressure_0_kpa = 1.0f,
        .pressure_1_kpa = 2.0f,
        .pressure_2_kpa = 3.0f,
        .pressure_0_kpa_valid = true,
        .pressure_1_kpa_valid = true,
        .pressure_2_kpa_valid = true,
        .pressure_kpa_valid = true,
        .hall_mm_valid = true,
        .pressure_saturation_mask = 0,
        .ts_ms = 123456,
    };
    strcpy(snap.hand_placement, "CENTER");
    strcpy(snap.flags, "DEPTH_OK,RATE_OK,RECOIL_OK");
    return snap;
}

static sensor_raw_sample_t base_raw_sample(void)
{
    return (sensor_raw_sample_t) {
        .pressure_raw = {1010, 2020, 3030},
        .pressure_read_valid = {true, true, true},
        .hall_raw = 1850,
        .hall_read_valid = true,
        .pressure_saturation_mask = 0u,
        .timestamp_ms = 124700,
    };
}

static sensor_converted_sample_t base_converted_sample(void)
{
    return (sensor_converted_sample_t) {
        .pressure_kpa = {1.0f, 2.0f, 3.0f},
        .pressure_kpa_channel_valid = {true, true, true},
        .pressure_kpa_valid = true,
        .pressure_profile_valid = true,
        .hall_mm = 24.5f,
        .hall_progress = 0.49f,
        .hall_mm_valid = true,
        .hall_profile_valid = true,
        .pressure_saturation_mask = 0u,
        .timestamp_ms = 124700,
    };
}

TEST_CASE("Session telemetry payload keeps legacy fields and adds converted fields", "[telemetry]")
{
    cpr_metrics_snapshot_t snap = base_snapshot();
    char payload[1792];

    TEST_ASSERT_EQUAL(ESP_OK, telemetry_publisher_build_session_payload(
                                  &snap, "M-DEV", "S-001", payload, sizeof(payload)));

    assert_contains(payload, "\"event_type\":\"session_telemetry\"");
    assert_contains(payload, "\"session_id\":\"S-001\"");
    assert_contains(payload, "\"depth_progress\":0.920");
    assert_contains(payload, "\"depth_ok\":true");
    assert_contains(payload, "\"rate_cpm\":108.0");
    assert_contains(payload, "\"compression_count\":18");
    assert_contains(payload, "\"valid_compression_count\":15");
    assert_contains(payload, "\"recoil_ok_count\":14");
    assert_contains(payload, "\"incomplete_recoil_count\":3");
    assert_contains(payload, "\"pause_s\":0.250");
    assert_contains(payload, "\"hand_placement\":\"CENTER\"");
    assert_contains(payload, "\"pressure_balance_pct\":8.50");
    assert_contains(payload, "\"flags\":\"DEPTH_OK,RATE_OK,RECOIL_OK\"");

    assert_contains(payload, "\"depth_mm\":46.000");
    assert_contains(payload, "\"depth_source\":\"HALL\"");
    assert_contains(payload, "\"pressure_0_kpa\":1.000");
    assert_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_contains(payload, "\"pressure_1_kpa\":2.000");
    assert_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_contains(payload, "\"pressure_2_kpa\":3.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":true");
    assert_contains(payload, "\"pressure_kpa_valid\":true");
    assert_contains(payload, "\"hall_mm_valid\":true");
    assert_contains(payload, "\"pressure_saturation_mask\":0");
    assert_contains(payload, "\"pressure_balance_reliable\":true");
}

TEST_CASE("Session telemetry payload reports one saturated pressure channel", "[telemetry]")
{
    cpr_metrics_snapshot_t snap = base_snapshot();
    snap.pressure_2_kpa = 9.0f;
    snap.pressure_2_kpa_valid = false;
    snap.pressure_kpa_valid = false;
    snap.pressure_saturation_mask = 0x04u;
    char payload[1792];

    TEST_ASSERT_EQUAL(ESP_OK, telemetry_publisher_build_session_payload(
                                  &snap, "M-DEV", "S-001", payload, sizeof(payload)));

    assert_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_contains(payload, "\"pressure_2_kpa\":0.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":false");
    assert_contains(payload, "\"pressure_kpa_valid\":false");
    assert_contains(payload, "\"pressure_saturation_mask\":4");
}

TEST_CASE("Session telemetry payload zeros invalid Hall depth without NaN", "[telemetry]")
{
    cpr_metrics_snapshot_t snap = base_snapshot();
    snap.depth_mm = 46.0f;
    snap.hall_mm_valid = false;
    char payload[1792];

    TEST_ASSERT_EQUAL(ESP_OK, telemetry_publisher_build_session_payload(
                                  &snap, "M-DEV", "S-001", payload, sizeof(payload)));

    assert_contains(payload, "\"depth_progress\":0.920");
    assert_contains(payload, "\"depth_mm\":0.000");
    assert_contains(payload, "\"hall_mm_valid\":false");
    TEST_ASSERT_NULL(strstr(payload, "nan"));
    TEST_ASSERT_NULL(strstr(payload, "inf"));
}

TEST_CASE("Sensor stream command validation requires request id action and interval", "[telemetry]")
{
    bool start = false;
    uint32_t interval_ms = 0;

    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"action\":\"START\",\"interval_ms\":200}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"\",\"action\":\"START\",\"interval_ms\":200}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"interval_ms\":200}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"action\":\"BOUNCE\",\"interval_ms\":200}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"action\":\"START\"}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"action\":\"START\",\"interval_ms\":99}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"action\":\"START\",\"interval_ms\":1001}",
                          &start,
                          &interval_ms));

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r1\",\"action\":\"START\",\"interval_ms\":200}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_TRUE(start);
    TEST_ASSERT_EQUAL_UINT32(200, interval_ms);

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_validate_sensor_stream_command(
                          "{\"request_id\":\"r2\",\"action\":\"STOP\"}",
                          &start,
                          &interval_ms));
    TEST_ASSERT_FALSE(start);
}

TEST_CASE("Sensor stream payload contains diagnostics fields without session scoring", "[telemetry]")
{
    sensor_raw_sample_t raw = base_raw_sample();
    sensor_converted_sample_t converted = base_converted_sample();
    char payload[1280];

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_build_sensor_stream_payload(
                          "M-DEV",
                          RESQ_STATE_PAIRED_IDLE,
                          &raw,
                          &converted,
                          200,
                          payload,
                          sizeof(payload)));

    assert_contains(payload, "\"device_id\":\"M-DEV\"");
    assert_contains(payload, "\"telemetry_mode\":\"SENSOR_STREAM\"");
    assert_contains(payload, "\"state\":\"PAIRED_IDLE\"");
    assert_contains(payload, "\"pressure_0_raw\":1010");
    assert_contains(payload, "\"pressure_0_raw_valid\":true");
    assert_contains(payload, "\"pressure_1_raw\":2020");
    assert_contains(payload, "\"pressure_1_raw_valid\":true");
    assert_contains(payload, "\"pressure_2_raw\":3030");
    assert_contains(payload, "\"pressure_2_raw_valid\":true");
    assert_contains(payload, "\"hall_raw\":1850");
    assert_contains(payload, "\"hall_raw_valid\":true");
    assert_contains(payload, "\"pressure_0_kpa\":1.000");
    assert_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_contains(payload, "\"pressure_1_kpa\":2.000");
    assert_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_contains(payload, "\"pressure_2_kpa\":3.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":true");
    assert_contains(payload, "\"pressure_kpa_valid\":true");
    assert_contains(payload, "\"hall_mm\":24.500");
    assert_contains(payload, "\"hall_progress\":0.490");
    assert_contains(payload, "\"hall_mm_valid\":true");
    assert_contains(payload, "\"pressure_profile_valid\":true");
    assert_contains(payload, "\"hall_profile_valid\":true");
    assert_contains(payload, "\"pressure_saturation_mask\":0");
    assert_contains(payload, "\"interval_ms\":200");
    assert_contains(payload, "\"ts_ms\":124700");
    assert_not_contains(payload, "session_id");
    assert_not_contains(payload, "compression_count");
    assert_not_contains(payload, "rate_cpm");
    assert_not_contains(payload, "score");
}

TEST_CASE("Sensor stream payload zeros saturated or invalid converted values", "[telemetry]")
{
    sensor_raw_sample_t raw = base_raw_sample();
    raw.pressure_raw[2] = 8300000;
    sensor_converted_sample_t converted = {
        .pressure_kpa = {1.0f, 2.0f, 999.0f},
        .pressure_kpa_channel_valid = {true, true, false},
        .pressure_kpa_valid = false,
        .pressure_profile_valid = true,
        .hall_mm = 0.0f,
        .hall_progress = 0.0f,
        .hall_mm_valid = false,
        .hall_profile_valid = false,
        .pressure_saturation_mask = 0x04u,
        .timestamp_ms = 124700,
    };
    char payload[1280];

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_build_sensor_stream_payload(
                          "M-DEV",
                          RESQ_STATE_READY_FOR_SESSION,
                          &raw,
                          &converted,
                          100,
                          payload,
                          sizeof(payload)));

    assert_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_contains(payload, "\"pressure_2_raw\":8300000");
    assert_contains(payload, "\"pressure_2_raw_valid\":true");
    assert_contains(payload, "\"pressure_2_kpa\":0.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":false");
    assert_contains(payload, "\"pressure_kpa_valid\":false");
    assert_contains(payload, "\"hall_mm\":0.000");
    assert_contains(payload, "\"hall_mm_valid\":false");
    assert_contains(payload, "\"pressure_profile_valid\":true");
    assert_contains(payload, "\"hall_profile_valid\":false");
    assert_contains(payload, "\"pressure_saturation_mask\":4");
    TEST_ASSERT_NULL(strstr(payload, "nan"));
    TEST_ASSERT_NULL(strstr(payload, "inf"));
}

TEST_CASE("Sensor stream payload includes valid raw readings before calibration", "[telemetry]")
{
    sensor_raw_sample_t raw = base_raw_sample();
    raw.pressure_read_valid[1] = false;
    sensor_converted_sample_t converted = {
        .pressure_kpa = {12.0f, 13.0f, 14.0f},
        .pressure_kpa_channel_valid = {false, false, false},
        .pressure_kpa_valid = false,
        .pressure_profile_valid = false,
        .hall_mm = 31.0f,
        .hall_progress = 0.62f,
        .hall_mm_valid = false,
        .hall_profile_valid = false,
        .pressure_saturation_mask = 0u,
        .timestamp_ms = 124700,
    };
    char payload[1280];

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_build_sensor_stream_payload(
                          "M-DEV",
                          RESQ_STATE_CALIBRATING,
                          &raw,
                          &converted,
                          200,
                          payload,
                          sizeof(payload)));

    assert_contains(payload, "\"pressure_0_raw\":1010");
    assert_contains(payload, "\"pressure_0_raw_valid\":true");
    assert_contains(payload, "\"pressure_1_raw\":2020");
    assert_contains(payload, "\"pressure_1_raw_valid\":false");
    assert_contains(payload, "\"pressure_2_raw\":3030");
    assert_contains(payload, "\"pressure_2_raw_valid\":true");
    assert_contains(payload, "\"hall_raw\":1850");
    assert_contains(payload, "\"hall_raw_valid\":true");
    assert_contains(payload, "\"pressure_0_kpa\":0.000");
    assert_contains(payload, "\"pressure_0_kpa_valid\":false");
    assert_contains(payload, "\"pressure_1_kpa\":0.000");
    assert_contains(payload, "\"pressure_1_kpa_valid\":false");
    assert_contains(payload, "\"pressure_2_kpa\":0.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":false");
    assert_contains(payload, "\"pressure_kpa_valid\":false");
    assert_contains(payload, "\"hall_mm\":0.000");
    assert_contains(payload, "\"hall_progress\":0.000");
    assert_contains(payload, "\"hall_mm_valid\":false");
    assert_contains(payload, "\"pressure_profile_valid\":false");
    assert_contains(payload, "\"hall_profile_valid\":false");
    assert_not_contains(payload, "session_id");
    assert_not_contains(payload, "compression_count");
}

TEST_CASE("Sensor stream payload preserves calibrated converted values", "[telemetry]")
{
    sensor_raw_sample_t raw = base_raw_sample();
    sensor_converted_sample_t converted = base_converted_sample();
    char payload[1280];

    TEST_ASSERT_EQUAL(ESP_OK,
                      telemetry_publisher_build_sensor_stream_payload(
                          "M-DEV",
                          RESQ_STATE_READY_FOR_SESSION,
                          &raw,
                          &converted,
                          250,
                          payload,
                          sizeof(payload)));

    assert_contains(payload, "\"pressure_0_raw_valid\":true");
    assert_contains(payload, "\"pressure_1_raw_valid\":true");
    assert_contains(payload, "\"pressure_2_raw_valid\":true");
    assert_contains(payload, "\"hall_raw_valid\":true");
    assert_contains(payload, "\"pressure_0_kpa\":1.000");
    assert_contains(payload, "\"pressure_0_kpa_valid\":true");
    assert_contains(payload, "\"pressure_1_kpa\":2.000");
    assert_contains(payload, "\"pressure_1_kpa_valid\":true");
    assert_contains(payload, "\"pressure_2_kpa\":3.000");
    assert_contains(payload, "\"pressure_2_kpa_valid\":true");
    assert_contains(payload, "\"pressure_kpa_valid\":true");
    assert_contains(payload, "\"hall_mm\":24.500");
    assert_contains(payload, "\"hall_progress\":0.490");
    assert_contains(payload, "\"hall_mm_valid\":true");
}

TEST_CASE("USB mode rejects manual SENSOR_STREAM start", "[telemetry][io_mode]")
{
    io_mode_manager_set_for_test(RESQ_IO_MODE_USB);
    network_config_t network = {0};
    calibration_config_t calibration = {0};
    resq_mqtt_command_t command = {0};
    strcpy(command.topic, "resq/test/cmd/telemetry");
    strcpy(command.payload,
           "{\"request_id\":\"usb-stream-1\",\"action\":\"START\"}");
    command.payload_len = (int)strlen(command.payload);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      telemetry_publisher_handle_sensor_stream_command(
                          &network, RESQ_STATE_PAIRED_IDLE, &calibration,
                          &command, true));
    TEST_ASSERT_FALSE(telemetry_publisher_is_sensor_stream_running());
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);
}
