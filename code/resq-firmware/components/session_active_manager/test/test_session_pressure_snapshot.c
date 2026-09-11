#include "session_active_manager.h"

#include "freertos/task.h"
#include "sensor_owner.h"
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
        &snapshot, 6, 1201, SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS));
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

    const TickType_t interval = session_pressure_sample_interval_ticks();
    TEST_ASSERT_GREATER_THAN_UINT32(0u, interval);
    TEST_ASSERT_EQUAL_UINT32(
        pdMS_TO_TICKS(SESSION_PRESSURE_SAMPLE_INTERVAL_MS), interval);

    const session_pressure_cycle_path_t paths[] = {
        SESSION_PRESSURE_CYCLE_SUCCESS,
        SESSION_PRESSURE_CYCLE_TIMEOUT,
        SESSION_PRESSURE_CYCLE_INVALID_RESPONSE,
        SESSION_PRESSURE_CYCLE_OWNER_CONTENTION,
    };
    for (size_t i = 0; i < sizeof(paths) / sizeof(paths[0]); ++i) {
        TickType_t next_wake = 100;
        TickType_t block_ticks =
            session_pressure_cycle_block_ticks(paths[i], 100, &next_wake);
        TEST_ASSERT_GREATER_THAN_UINT32(0u, block_ticks);
        TEST_ASSERT_EQUAL_UINT32(100u + interval, next_wake);
    }

    TickType_t overdue_wake = 100;
    TickType_t overdue_block = session_pressure_cycle_block_ticks(
        SESSION_PRESSURE_CYCLE_SUCCESS, 500, &overdue_wake);
    TEST_ASSERT_EQUAL_UINT32(interval, overdue_block);
    TEST_ASSERT_EQUAL_UINT32(500u + interval, overdue_wake);

    TEST_ASSERT_TRUE(session_pressure_cycle_should_sample(false));
    TEST_ASSERT_FALSE(session_pressure_cycle_should_sample(true));

    TaskHandle_t current_task = xTaskGetCurrentTaskHandle();
    xTaskNotifyGive(current_task);
    TickType_t stop_wait_started = xTaskGetTickCount();
    TEST_ASSERT_EQUAL_UINT32(
        1u, session_pressure_wait_for_next_cycle(interval));
    TEST_ASSERT_LESS_OR_EQUAL_UINT32(
        1u, xTaskGetTickCount() - stop_wait_started);

    TEST_ASSERT_TRUE(session_pressure_tasks_can_start(false, false));
    TEST_ASSERT_FALSE(session_pressure_tasks_can_start(true, false));
    TEST_ASSERT_FALSE(session_pressure_tasks_can_start(false, true));
    TEST_ASSERT_FALSE(session_pressure_tasks_can_start(true, true));
    for (size_t cycle = 0; cycle < 3; ++cycle) {
        TEST_ASSERT_TRUE(session_pressure_tasks_can_start(false, false));
        TEST_ASSERT_FALSE(session_pressure_tasks_can_start(true, true));
    }

    sensor_owner_reset_for_test();
    TEST_ASSERT_EQUAL(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(
        ESP_OK, sensor_owner_release(SENSOR_OWNER_SESSION));
    sensor_owner_t owner = SENSOR_OWNER_SESSION;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_get(&owner));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, owner);
}
