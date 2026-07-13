#include "unity.h"

#include "sensor_owner.h"

static sensor_owner_t get_owner(void)
{
    sensor_owner_t owner = SENSOR_OWNER_NONE;
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_get(&owner));
    return owner;
}

TEST_CASE("Sensor owner acquires free owner and releases by owner only", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, get_owner());
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_MANUAL_STREAM));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_MANUAL_STREAM, get_owner());

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_MANUAL_STREAM, get_owner());

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_MANUAL_STREAM));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, get_owner());
}

TEST_CASE("Sensor owner rejects competing owner without overwrite", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_CALIBRATION));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, sensor_owner_acquire(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_CALIBRATION, get_owner());
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_CALIBRATION));
}

TEST_CASE("Sensor owner rejects repeated release", "[sensor_owner]")
{
    sensor_owner_reset_for_test();

    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      sensor_owner_release(SENSOR_OWNER_SESSION));
    TEST_ASSERT_EQUAL(SENSOR_OWNER_NONE, get_owner());
}

TEST_CASE("Sensor owner initialization is idempotent", "[sensor_owner]")
{
    sensor_owner_reset_for_test();
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_acquire(SENSOR_OWNER_CALIBRATION));
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL(SENSOR_OWNER_CALIBRATION, get_owner());
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_release(SENSOR_OWNER_CALIBRATION));
}
