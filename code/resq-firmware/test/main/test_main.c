#include <stdio.h>

#include "board_config.h"
#include "config_store.h"
#include "esp_err.h"
#include "hx710.h"
#include "io_mode_manager.h"
#include "sensor_owner.h"
#include "unity.h"

extern void resq_raw_sensor_output_tests_link_anchor(void);
extern void resq_hx710_diagnostic_tests_link_anchor(void);

void app_main(void)
{
    esp_err_t config_result = config_store_init();
    esp_err_t mode_result = config_result == ESP_OK
        ? io_mode_manager_init()
        : config_result;
    esp_err_t sck_result = ESP_ERR_INVALID_STATE;
    if (mode_result == ESP_OK && io_mode_manager_is_sensor()) {
        sck_result =
            hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
    }
    esp_err_t owner_result = sensor_owner_init();

    printf("\nResQ firmware Unity test application\n");
    printf("UNITY_BOOT,io_mode=%s,config=%s,io_mode_init=%s,sck_owner=%s,"
           "sensor_owner=%s\n",
           io_mode_to_string(io_mode_manager_get()),
           esp_err_to_name(config_result), esp_err_to_name(mode_result),
           esp_err_to_name(sck_result),
           esp_err_to_name(owner_result));
    resq_raw_sensor_output_tests_link_anchor();
    resq_hx710_diagnostic_tests_link_anchor();
    unity_run_menu();
}
