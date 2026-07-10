#include "unity.h"

#include "sensor_owner.h"

TEST_CASE("Sensor owner acquires free owner and releases by owner only", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, sensor_owner_get());
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_MANUAL_STREAM));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_MANUAL_STREAM, sensor_owner_get());

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_MANUAL_STREAM, sensor_owner_get());

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_MANUAL_STREAM));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, sensor_owner_get());
}

TEST_CASE("Sensor owner rejects competing owner without overwrite", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_CALIBRATION));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, sensor_owner_acquire(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_CALIBRATION, sensor_owner_get());
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_CALIBRATION));
}

TEST_CASE("Sensor owner repeated release is safe", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, sensor_owner_get());
}
