#include "io_mode_manager.h"

#include "config_store.h"
#include "hx710.h"
#include "nvs.h"
#include "unity.h"

TEST_CASE("requesting active mode does not create an NVS write",
          "[io_mode]")
{
    TEST_ASSERT_EQUAL(ESP_OK, config_store_init());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_all());
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);

    TEST_ASSERT_EQUAL(ESP_OK,
                      io_mode_manager_request(RESQ_IO_MODE_SENSOR));

    nvs_handle_t handle;
    TEST_ASSERT_EQUAL(ESP_OK, nvs_open("resq_cfg", NVS_READONLY, &handle));
    uint8_t stored = 0xff;
    TEST_ASSERT_EQUAL(ESP_ERR_NVS_NOT_FOUND,
                      nvs_get_u8(handle, "io_mode", &stored));
    nvs_close(handle);
}

TEST_CASE("request persists target without live mode swap", "[io_mode]")
{
    TEST_ASSERT_EQUAL(ESP_OK, config_store_init());
    TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_all());
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);

    TEST_ASSERT_EQUAL(ESP_OK, io_mode_manager_request(RESQ_IO_MODE_USB));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_SENSOR, io_mode_manager_get());

    resq_io_mode_t stored = RESQ_IO_MODE_SENSOR;
    TEST_ASSERT_EQUAL(ESP_OK, config_store_load_io_mode(&stored));
    TEST_ASSERT_EQUAL(RESQ_IO_MODE_USB, stored);
}

TEST_CASE("USB mode rejects HX710 access before GPIO setup", "[io_mode][hx710]")
{
    io_mode_manager_set_for_test(RESQ_IO_MODE_USB);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      hx710_init(GPIO_NUM_19, GPIO_NUM_1));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      hx710_hold_sck_low(GPIO_NUM_19));

    int32_t out0 = 0;
    int32_t out1 = 0;
    int32_t out2 = 0;
    uint8_t valid_mask = 0xff;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      hx710_read_3_shared_sck_valid(
                          GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3, GPIO_NUM_10,
                          &out0, &out1, &out2, &valid_mask));
    TEST_ASSERT_EQUAL_UINT8(0, valid_mask);
}
