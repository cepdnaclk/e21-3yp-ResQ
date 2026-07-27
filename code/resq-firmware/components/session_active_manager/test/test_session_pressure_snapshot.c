#include "session_active_manager.h"

#include "unity.h"

TEST_CASE("session pressure snapshot is copied and sequenced safely",
          "[session_pressure]")
{
    TEST_ASSERT_EQUAL(ESP_OK, session_active_manager_init());

    session_pressure_snapshot_t source = {
        .raw = {101, 202, 303},
        .valid_mask = 0x07u,
        .saturation_mask = 0x04u,
        .read_error = ESP_OK,
        .timestamp_ms = 1000,
        .available = true,
    };
    TEST_ASSERT_EQUAL(
        ESP_OK, session_pressure_snapshot_store(&source));

    source.raw[1] = 999;
    session_pressure_snapshot_t copied = {0};
    TEST_ASSERT_EQUAL(
        ESP_OK, session_pressure_snapshot_get(&copied));
    TEST_ASSERT_EQUAL_INT32(202, copied.raw[1]);
    TEST_ASSERT_EQUAL_UINT8(0x07u, copied.valid_mask);
    TEST_ASSERT_EQUAL_UINT8(0x04u, copied.saturation_mask);
    TEST_ASSERT_NOT_EQUAL(0u, copied.sequence);
    TEST_ASSERT_TRUE(copied.available);
}

TEST_CASE("session pressure snapshot freshness rejects stale and duplicate frames",
          "[session_pressure]")
{
    session_pressure_snapshot_t snapshot = {
        .timestamp_ms = 1000,
        .sequence = 7,
        .available = true,
    };

    TEST_ASSERT_TRUE(session_pressure_snapshot_is_fresh(
        &snapshot, 6, 1050, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
    TEST_ASSERT_FALSE(session_pressure_snapshot_is_fresh(
        &snapshot, 7, 1050, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
    TEST_ASSERT_FALSE(session_pressure_snapshot_is_fresh(
        &snapshot, 6, 1101, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
    TEST_ASSERT_FALSE(session_pressure_snapshot_is_fresh(
        &snapshot, 6, 999, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
}

TEST_CASE("unavailable pressure snapshot is never consumed",
          "[session_pressure]")
{
    session_pressure_snapshot_t snapshot = {
        .timestamp_ms = 1000,
        .sequence = 8,
        .available = false,
    };
    TEST_ASSERT_FALSE(session_pressure_snapshot_is_fresh(
        &snapshot, 0, 1000, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
}
