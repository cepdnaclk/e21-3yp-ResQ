#include "config_store.h"

#include "nvs.h"
#include "unity.h"

#define TEST_RESQ_NVS_NAMESPACE "resq_cfg"
#define TEST_IO_MODE_KEY "io_mode"

static void reset_store(void)
{
    TEST_ASSERT_EQUAL(ESP_OK, config_store_init());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_all());
}

TEST_CASE("missing io mode defaults to SENSOR", "[config][io_mode]")
{
    reset_store();
    resq_io_mode_t mode = RESQ_IO_MODE_USB;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, mode);
}

TEST_CASE("SENSOR and USB io modes save and load", "[config][io_mode]")
{
    reset_store();
    resq_io_mode_t mode = RESQ_IO_MODE_SENSOR;

    TEST_ASSERT_EQUAL(ESP_OK, config_store_save_io_mode(RESQ_IO_MODE_USB));
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_USB, mode);

    TEST_ASSERT_EQUAL(ESP_OK, config_store_save_io_mode(RESQ_IO_MODE_SENSOR));
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, mode);
}

TEST_CASE("invalid io mode falls back to SENSOR", "[config][io_mode]")
{
    reset_store();
    nvs_handle_t handle;
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READWRITE, &handle));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_set_u8(handle, TEST_IO_MODE_KEY, 0x7f));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_commit(handle));
    nvs_close(handle);

    resq_io_mode_t mode = RESQ_IO_MODE_USB;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, mode);
}

TEST_CASE("network clear preserves io mode and clear all resets it",
          "[config][io_mode]")
{
    reset_store();
    resq_io_mode_t mode = RESQ_IO_MODE_SENSOR;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_save_io_mode(RESQ_IO_MODE_USB));
    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_network());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_USB, mode);

    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_all());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, mode);
}
