#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#include "board_config.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hall_sensor.h"
#include "hx710.h"
#include "io_mode_manager.h"
#include "sensor_owner.h"
#include "unity.h"

#define RAW_SENSOR_SAMPLE_COUNT 100
#define RAW_SENSOR_SAMPLE_DELAY_MS 50
#define HX710_HARDWARE_SAMPLE_COUNT 20u
#define HX710_HARDWARE_MIN_VALID_READS 15u

typedef struct {
    int32_t pressure_ref;
    int32_t pressure_1;
    int32_t pressure_2;
    uint8_t valid_mask;
    esp_err_t error;
} raw_pressure_sample_t;

void resq_raw_sensor_output_tests_link_anchor(void)
{
}

static esp_err_t raw_sensor_init_hall(hall_sensor_t *hall)
{
    return hall_sensor_init(hall, BOARD_HALL_ADC_CHAN);
}

static esp_err_t raw_sensor_init_pressure(void)
{
    esp_err_t err =
        hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
    if (err != ESP_OK) return err;

    err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT);
    if (err != ESP_OK) return err;
    err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT);
    if (err != ESP_OK) return err;
    return hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT);
}

static raw_pressure_sample_t raw_sensor_read_pressure(void)
{
    raw_pressure_sample_t sample = {
        .pressure_ref = HX710_ERROR_TIMEOUT,
        .pressure_1 = HX710_ERROR_TIMEOUT,
        .pressure_2 = HX710_ERROR_TIMEOUT,
        .valid_mask = 0,
        .error = ESP_FAIL,
    };
    sample.error = hx710_read_3_shared_sck_valid(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT, BOARD_HX710_1_DOUT, BOARD_HX710_2_DOUT,
        &sample.pressure_ref, &sample.pressure_1, &sample.pressure_2,
        &sample.valid_mask);
    return sample;
}

static esp_err_t channel_error(const raw_pressure_sample_t *sample,
                               uint8_t channel_mask)
{
    if (sample->valid_mask & channel_mask) return ESP_OK;
    return sample->error == ESP_OK ? ESP_ERR_TIMEOUT : sample->error;
}

static void print_pressure_field(const char *name,
                                 int32_t raw,
                                 uint8_t channel_mask,
                                 const raw_pressure_sample_t *sample)
{
    bool valid = (sample->valid_mask & channel_mask) != 0;
    printf(",%s_valid=%s,%s_error=%s", name, valid ? "true" : "false",
           name, esp_err_to_name(channel_error(sample, channel_mask)));
    if (valid) printf(",%s_raw=%ld", name, (long)raw);
}

static void print_pressure_sample(const char *kind,
                                  int sample_index,
                                  const raw_pressure_sample_t *sample,
                                  bool include_hall,
                                  int hall_raw)
{
    printf("RAW_SENSOR,%s,sample=%d", kind, sample_index);
    if (include_hall) printf(",hall_raw=%d", hall_raw);
    print_pressure_field("pressure_1", sample->pressure_1,
                         HX710_VALID_CHANNEL_1, sample);
    print_pressure_field("pressure_2", sample->pressure_2,
                         HX710_VALID_CHANNEL_2, sample);
    print_pressure_field("pressure_ref", sample->pressure_ref,
                         HX710_VALID_CHANNEL_0, sample);
    printf(",valid_mask=0x%02x,group_error=%s\n",
           sample->valid_mask, esp_err_to_name(sample->error));
}

static void assert_pressure_cleanup(esp_err_t setup_result,
                                    esp_err_t low_result,
                                    int final_sck,
                                    esp_err_t release_result,
                                    unsigned valid_channel_reads)
{
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, low_result,
                              "Raw pressure test could not restore SCK LOW");
    TEST_ASSERT_EQUAL_MESSAGE(0, final_sck,
                              "Raw pressure test left shared SCK HIGH");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, release_result,
                              "Raw pressure test did not release sensor ownership");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, setup_result,
                              "Raw pressure test initialization failed");
    TEST_ASSERT_GREATER_THAN_UINT32_MESSAGE(
        0, valid_channel_reads,
        "No valid HX710 reads; see validity/error fields above");
}

TEST_CASE("test_read_hall_sensor_raw_values", "[sensor_raw][hardware]")
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

TEST_CASE("test_read_pressure_sensor_raw_values", "[sensor_raw][hardware]")
{
    TEST_ASSERT_TRUE_MESSAGE(io_mode_manager_is_sensor(),
                             "Raw pressure reads require SENSOR I/O mode");
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL_MESSAGE(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_DIAGNOSTIC),
        "Raw pressure test could not acquire sensor ownership");

    esp_err_t setup_result = raw_sensor_init_pressure();
    unsigned valid_channel_reads = 0;
    if (setup_result == ESP_OK) {
        for (int sample = 0; sample < RAW_SENSOR_SAMPLE_COUNT; sample++) {
            raw_pressure_sample_t pressure = raw_sensor_read_pressure();
            valid_channel_reads += __builtin_popcount((unsigned)pressure.valid_mask);
            print_pressure_sample("PRESSURE", sample, &pressure, false, 0);
            vTaskDelay(pdMS_TO_TICKS(RAW_SENSOR_SAMPLE_DELAY_MS));
        }
    }

    esp_err_t low_result = hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
    int final_sck = gpio_get_level(BOARD_HX710_SHARED_SCK);
    esp_err_t release_result = sensor_owner_release(SENSOR_OWNER_DIAGNOSTIC);
    assert_pressure_cleanup(setup_result, low_result, final_sck,
                            release_result, valid_channel_reads);
}

TEST_CASE("test_read_all_sensor_raw_values", "[sensor_raw][hardware]")
{
    TEST_ASSERT_TRUE_MESSAGE(io_mode_manager_is_sensor(),
                             "Combined raw reads require SENSOR I/O mode");
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL_MESSAGE(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_DIAGNOSTIC),
        "Combined raw test could not acquire sensor ownership");

    hall_sensor_t hall = {0};
    esp_err_t setup_result = raw_sensor_init_hall(&hall);
    if (setup_result == ESP_OK) setup_result = raw_sensor_init_pressure();
    unsigned valid_channel_reads = 0;
    if (setup_result == ESP_OK) {
        for (int sample = 0; sample < RAW_SENSOR_SAMPLE_COUNT; sample++) {
            int hall_raw = 0;
            esp_err_t hall_result = hall_sensor_read_raw(&hall, &hall_raw);
            if (hall_result != ESP_OK) {
                setup_result = hall_result;
                break;
            }
            raw_pressure_sample_t pressure = raw_sensor_read_pressure();
            valid_channel_reads += __builtin_popcount((unsigned)pressure.valid_mask);
            print_pressure_sample("ALL", sample, &pressure, true, hall_raw);
            vTaskDelay(pdMS_TO_TICKS(RAW_SENSOR_SAMPLE_DELAY_MS));
        }
    }

    esp_err_t low_result = hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
    int final_sck = gpio_get_level(BOARD_HX710_SHARED_SCK);
    esp_err_t release_result = sensor_owner_release(SENSOR_OWNER_DIAGNOSTIC);
    assert_pressure_cleanup(setup_result, low_result, final_sck,
                            release_result, valid_channel_reads);
}

TEST_CASE("test_hx710_minimum_valid_read_ratio",
          "[sensor_raw][hx710_diag][hardware]")
{
    TEST_ASSERT_TRUE_MESSAGE(io_mode_manager_is_sensor(),
                             "HX710 ratio test requires SENSOR I/O mode");
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL_MESSAGE(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_DIAGNOSTIC),
        "HX710 ratio test could not acquire sensor ownership");

    esp_err_t setup_result = raw_sensor_init_pressure();
    unsigned valid_reads = 0;
    if (setup_result == ESP_OK) {
        for (unsigned sample = 0;
             sample < HX710_HARDWARE_SAMPLE_COUNT;
             ++sample) {
            raw_pressure_sample_t pressure = raw_sensor_read_pressure();
            if (pressure.error == ESP_OK &&
                pressure.valid_mask == HX710_VALID_CHANNEL_ALL) {
                valid_reads++;
            }
            print_pressure_sample("VALID_RATIO", (int)sample, &pressure,
                                  false, 0);
        }
    }

    printf("HX710_DIAG,VALID_RATIO,successful_reads=%u,total=%u,"
           "required=%u\n",
           valid_reads, HX710_HARDWARE_SAMPLE_COUNT,
           HX710_HARDWARE_MIN_VALID_READS);

    esp_err_t low_result = hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
    int final_sck = gpio_get_level(BOARD_HX710_SHARED_SCK);
    esp_err_t release_result = sensor_owner_release(SENSOR_OWNER_DIAGNOSTIC);
    assert_pressure_cleanup(setup_result, low_result, final_sck,
                            release_result, valid_reads * 3u);
    TEST_ASSERT_GREATER_OR_EQUAL_UINT32(HX710_HARDWARE_MIN_VALID_READS,
                                        valid_reads);
}
