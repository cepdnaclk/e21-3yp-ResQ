#include "config_store.h"

#include <string.h>

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

TEST_CASE("io mode save preserves network password and calibration keys",
          "[config][io_mode]")
{
    reset_store();

    network_config_t saved = {0};
    strcpy(saved.wifi_ssid, "ResQ Lab");
    strcpy(saved.wifi_pass, "p@ss&word=123 +%");
    strcpy(saved.backend_base_url, "http://192.0.2.10:18080");
    saved.provisioned = true;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_save_network(&saved));

    nvs_handle_t handle;
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READWRITE, &handle));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_set_i32(handle, "hall_base", 12345));
    TEST_ASSERT_EQUAL(ESP_OK, nvs_commit(handle));
    nvs_close(handle);

    TEST_ASSERT_EQUAL(ESP_OK, config_store_save_io_mode(RESQ_IO_MODE_USB));

    network_config_t loaded = {0};
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_network(&loaded));
    TEST_ASSERT_EQUAL_STRING(saved.wifi_ssid, loaded.wifi_ssid);
    TEST_ASSERT_EQUAL_STRING(saved.wifi_pass, loaded.wifi_pass);
    TEST_ASSERT_EQUAL_STRING(saved.backend_base_url, loaded.backend_base_url);
    TEST_ASSERT_TRUE(loaded.provisioned);

    int32_t hall_baseline = 0;
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READONLY, &handle));
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_get_i32(handle, "hall_base", &hall_baseline));
    nvs_close(handle);
    TEST_ASSERT_EQUAL_INT32(12345, hall_baseline);

    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_network());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_network(&loaded));
    TEST_ASSERT_EQUAL_CHAR('\0', loaded.wifi_pass[0]);
    TEST_ASSERT_EQUAL_CHAR('\0', loaded.backend_base_url[0]);
    TEST_ASSERT_FALSE(loaded.provisioned);

    resq_io_mode_t mode = RESQ_IO_MODE_SENSOR;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_USB, mode);
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READONLY, &handle));
    TEST_ASSERT_EQUAL(ESP_OK,
                      nvs_get_i32(handle, "hall_base", &hall_baseline));
    nvs_close(handle);

    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_all());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&mode));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, mode);
}
