#include <stdint.h>
#include <stdio.h>

#include "board_config.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "unity.h"

#define RAW_SENSOR_SAMPLE_COUNT 100
#define RAW_SENSOR_SAMPLE_DELAY_MS 50

void resq_raw_sensor_output_tests_link_anchor(void)
{
}

static esp_err_t raw_sensor_init_hall(hall_sensor_t *hall)
{
    return hall_sensor_init(hall, BOARD_HALL_ADC_CHAN);
}

static esp_err_t raw_sensor_init_pressure(void)
{
    esp_err_t err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT);
    if (err != ESP_OK) {
        return err;
    }

    err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT);
    if (err != ESP_OK) {
        return err;
    }

    return hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT);
}

static esp_err_t raw_sensor_read_pressure(int32_t *pressure_ref_raw,
                                          int32_t *pressure_1_raw,
                                          int32_t *pressure_2_raw)
{
    return hx710_read_3_shared_sck(BOARD_HX710_SHARED_SCK,
                                   BOARD_HX710_0_DOUT,
                                   BOARD_HX710_1_DOUT,
                                   BOARD_HX710_2_DOUT,
                                   pressure_ref_raw,
                                   pressure_1_raw,
                                   pressure_2_raw);
}

TEST_CASE("test_read_hall_sensor_raw_values", "[sensor_raw]")
{
    hall_sensor_t hall = {0};
    TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_init_hall(&hall));

    for (int sample = 0; sample < RAW_SENSOR_SAMPLE_COUNT; sample++) {
        int hall_raw = 0;
        TEST_ASSERT_EQUAL(ESP_OK, hall_sensor_read_raw(&hall, &hall_raw));

        printf("RAW_SENSOR,HALL,sample=%d,hall_raw=%d\n", sample, hall_raw);
        vTaskDelay(pdMS_TO_TICKS(RAW_SENSOR_SAMPLE_DELAY_MS));
    }
}

TEST_CASE("test_read_pressure_sensor_raw_values", "[sensor_raw]")
{
    TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_init_pressure());

    for (int sample = 0; sample < RAW_SENSOR_SAMPLE_COUNT; sample++) {
        int32_t pressure_ref_raw = 0;
        int32_t pressure_1_raw = 0;
        int32_t pressure_2_raw = 0;

        TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_read_pressure(&pressure_ref_raw,
                                                           &pressure_1_raw,
                                                           &pressure_2_raw));

        printf("RAW_SENSOR,PRESSURE,sample=%d,pressure_1_raw=%ld,pressure_2_raw=%ld,pressure_ref_raw=%ld\n",
               sample,
               (long)pressure_1_raw,
               (long)pressure_2_raw,
               (long)pressure_ref_raw);
        vTaskDelay(pdMS_TO_TICKS(RAW_SENSOR_SAMPLE_DELAY_MS));
    }
}

TEST_CASE("test_read_all_sensor_raw_values", "[sensor_raw]")
{
    hall_sensor_t hall = {0};
    TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_init_hall(&hall));
    TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_init_pressure());

    for (int sample = 0; sample < RAW_SENSOR_SAMPLE_COUNT; sample++) {
        int hall_raw = 0;
        int32_t pressure_ref_raw = 0;
        int32_t pressure_1_raw = 0;
        int32_t pressure_2_raw = 0;

        TEST_ASSERT_EQUAL(ESP_OK, hall_sensor_read_raw(&hall, &hall_raw));
        TEST_ASSERT_EQUAL(ESP_OK, raw_sensor_read_pressure(&pressure_ref_raw,
                                                           &pressure_1_raw,
                                                           &pressure_2_raw));

        printf("RAW_SENSOR,ALL,sample=%d,hall_raw=%d,pressure_1_raw=%ld,pressure_2_raw=%ld,pressure_ref_raw=%ld\n",
               sample,
               hall_raw,
               (long)pressure_1_raw,
               (long)pressure_2_raw,
               (long)pressure_ref_raw);
        vTaskDelay(pdMS_TO_TICKS(RAW_SENSOR_SAMPLE_DELAY_MS));
    }
}
