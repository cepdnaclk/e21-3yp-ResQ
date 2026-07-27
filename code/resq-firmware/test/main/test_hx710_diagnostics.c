#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#include "board_config.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "hx710.h"
#include "io_mode_manager.h"
#include "sensor_owner.h"
#include "unity.h"

#define HX710_DIAG_WARMUP_SAMPLES 3u
#define HX710_DIAG_REQUIRED_VALID_READS 10u
#define HX710_DIAG_MAX_ATTEMPTS 20u

typedef struct {
    const char *name;
    gpio_num_t dout;
    uint8_t mask;
    size_t raw_index;
} hx710_diag_channel_t;

typedef struct {
    uint8_t observed_next_ready_mask;
    uint8_t early_next_ready_warning_mask;
    int32_t first_next_ready_low_us[HX710_CHANNEL_COUNT];
} hx710_next_conversion_observation_t;

static const hx710_diag_channel_t s_channels[] = {
    {
        .name = "pressure_ref",
        .dout = BOARD_HX710_0_DOUT,
        .mask = HX710_VALID_CHANNEL_0,
        .raw_index = 0,
    },
    {
        .name = "pressure_1",
        .dout = BOARD_HX710_1_DOUT,
        .mask = HX710_VALID_CHANNEL_1,
        .raw_index = 1,
    },
    {
        .name = "pressure_2",
        .dout = BOARD_HX710_2_DOUT,
        .mask = HX710_VALID_CHANNEL_2,
        .raw_index = 2,
    },
};

void resq_hx710_diagnostic_tests_link_anchor(void)
{
}

static const char *channel_protocol_status(
    const hx710_group_result_t *result,
    uint8_t mask)
{
    if ((result->stuck_high_mask & mask) != 0) {
        return "STUCK_HIGH";
    }
    if ((result->stuck_low_mask & mask) != 0) {
        return "STUCK_LOW";
    }
    if ((result->post_read_invalid_mask & mask) != 0) {
        return "POST_READ_INVALID";
    }
    if ((result->not_ready_mask & mask) != 0) {
        return "NOT_READY";
    }
    if ((result->valid_mask & mask) != 0) {
        return "CURRENT_TRANSACTION_VALID";
    }
    return "INVALID";
}

static esp_err_t initialize_dout_inputs(void)
{
    for (size_t i = 0; i < sizeof(s_channels) / sizeof(s_channels[0]); ++i) {
        esp_err_t err = hx710_init(BOARD_HX710_SHARED_SCK,
                                   s_channels[i].dout);
        if (err != ESP_OK) {
            return err;
        }
    }
    return ESP_OK;
}

static uint8_t sample_initial_ready_mask(void)
{
    uint8_t mask = 0;
    for (size_t i = 0; i < sizeof(s_channels) / sizeof(s_channels[0]); ++i) {
        int level = gpio_get_level(s_channels[i].dout);
        if (level == 0) {
            mask |= s_channels[i].mask;
        }
        printf("HX710_DIAG,INITIAL,%s,GPIO%d,%s\n",
               s_channels[i].name, (int)s_channels[i].dout,
               level == 0 ? "LOW_READY_OR_STUCK" : "HIGH_NOT_READY");
    }
    return mask;
}

static hx710_next_conversion_observation_t
observe_next_conversion_timing(const hx710_group_result_t *result)
{
    hx710_next_conversion_observation_t observation = {
        .observed_next_ready_mask = result->observed_next_ready_mask,
        .early_next_ready_warning_mask =
            result->early_next_ready_warning_mask,
        .first_next_ready_low_us = {-1, -1, -1},
    };
    for (size_t channel = 0; channel < HX710_CHANNEL_COUNT; ++channel) {
        observation.first_next_ready_low_us[channel] =
            result->first_next_ready_low_us[channel];
    }

    if (result->error != ESP_OK ||
        result->valid_mask != HX710_VALID_CHANNEL_ALL) {
        return observation;
    }

    const int64_t started_us = esp_timer_get_time();
    const int64_t warning_window_us =
        (int64_t)HX710_MIN_CONVERSION_INTERVAL_MS * 1000;
    while ((esp_timer_get_time() - started_us) < warning_window_us) {
        int64_t elapsed_us = esp_timer_get_time() - started_us;
        for (size_t channel = 0;
             channel < sizeof(s_channels) / sizeof(s_channels[0]);
             ++channel) {
            const hx710_diag_channel_t *descriptor =
                &s_channels[channel];
            if (gpio_get_level(descriptor->dout) == 0) {
                observation.observed_next_ready_mask |= descriptor->mask;
                observation.early_next_ready_warning_mask |=
                    descriptor->mask;
                if (observation.first_next_ready_low_us[channel] < 0) {
                    observation.first_next_ready_low_us[channel] =
                        elapsed_us > INT32_MAX
                            ? INT32_MAX
                            : (int32_t)elapsed_us;
                }
            }
        }
        if (observation.observed_next_ready_mask ==
            HX710_VALID_CHANNEL_ALL) {
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    return observation;
}

static void print_group_result(unsigned sample,
                               uint8_t observed_initial_mask,
                               const hx710_group_result_t *result,
                               const hx710_next_conversion_observation_t
                                   *next_observation)
{
    for (size_t i = 0; i < sizeof(s_channels) / sizeof(s_channels[0]); ++i) {
        const hx710_diag_channel_t *channel = &s_channels[i];
        bool initially_ready =
            (observed_initial_mask & channel->mask) != 0;
        bool ready = (result->ready_mask & channel->mask) != 0;
        bool captured =
            (result->captured_raw_mask & channel->mask) != 0;
        bool valid = (result->valid_mask & channel->mask) != 0;

        printf("HX710_DIAG,READY,%s,GPIO%d,initial=%s,final=%s,"
               "status=%s\n",
               channel->name, (int)channel->dout,
               initially_ready ? "LOW" : "HIGH",
               ready ? "READY" : "NOT_READY",
               channel_protocol_status(result, channel->mask));

        if (valid) {
            printf("HX710_DIAG,RAW,%s,VALID,%ld,sample=%u\n",
                   channel->name,
                   (long)result->raw[channel->raw_index],
                   sample);
        } else if (captured) {
            printf("HX710_DIAG,RAW,%s,CAPTURED_INVALID,%ld,%s,"
                   "sample=%u\n",
                   channel->name,
                   (long)result->raw[channel->raw_index],
                   channel_protocol_status(result, channel->mask),
                   sample);
        } else {
            printf("HX710_DIAG,RAW,%s,INVALID,%s,sample=%u\n",
                   channel->name,
                   channel_protocol_status(result, channel->mask),
                   sample);
        }
    }

    printf("HX710_DIAG,GROUP,sample=%u,error=%s,captured_mask=0x%02x,"
           "valid_mask=0x%02x,"
           "not_ready_mask=0x%02x,stuck_high_mask=0x%02x,"
           "stuck_low_mask=0x%02x,post_invalid_mask=0x%02x,"
           "current_transaction=%s,next_conversion=%s,"
           "next_ready_warning_mask=0x%02x,"
           "first_next_ready_low_us=%ld,%ld,%ld,"
           "pulses=%u,ready_wait_ms=%lu,cleanup=%s\n",
           sample, esp_err_to_name(result->error),
           result->captured_raw_mask, result->valid_mask,
           result->not_ready_mask, result->stuck_high_mask,
           result->stuck_low_mask, result->post_read_invalid_mask,
           result->error == ESP_OK &&
                   result->valid_mask == HX710_VALID_CHANNEL_ALL
               ? "VALID"
               : "INVALID",
           next_observation->early_next_ready_warning_mask != 0
               ? "WARNING"
               : "NO_WARNING",
           next_observation->early_next_ready_warning_mask,
           (long)next_observation->first_next_ready_low_us[0],
           (long)next_observation->first_next_ready_low_us[1],
           (long)next_observation->first_next_ready_low_us[2],
           result->pulse_count,
           (unsigned long)result->ready_wait_ms,
           esp_err_to_name(result->cleanup_error));
}

static esp_err_t run_one_group_read(unsigned sample,
                                    hx710_group_result_t *out_result)
{
    uint8_t observed_initial_mask = sample_initial_ready_mask();
    esp_err_t err = hx710_read_group_shared_sck(
        BOARD_HX710_SHARED_SCK,
        BOARD_HX710_0_DOUT,
        BOARD_HX710_1_DOUT,
        BOARD_HX710_2_DOUT,
        out_result);
    hx710_next_conversion_observation_t next_observation =
        observe_next_conversion_timing(out_result);
    print_group_result(sample, observed_initial_mask, out_result,
                       &next_observation);
    return err;
}

static void assert_diagnostic_cleanup(esp_err_t setup_result,
                                      esp_err_t read_result,
                                      esp_err_t low_result,
                                      int final_sck,
                                      esp_err_t release_result)
{
    printf("HX710_DIAG,SCK_CLEANUP,%s\n",
           final_sck == 0 && low_result == ESP_OK ? "LOW" : "INVALID");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, setup_result,
                              "HX710 group diagnostic setup failed");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, read_result,
                              "HX710 synchronized group read failed");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, low_result,
                              "Failed to force shared SCK LOW");
    TEST_ASSERT_EQUAL_MESSAGE(0, final_sck,
                              "Shared SCK is not LOW after diagnostics");
    TEST_ASSERT_EQUAL_MESSAGE(ESP_OK, release_result,
                              "Diagnostic sensor ownership was not released");
}

TEST_CASE("test_hx710_shared_sck_and_dout_diagnostics",
          "[hx710_diag][hardware]")
{
    TEST_ASSERT_TRUE_MESSAGE(io_mode_manager_is_sensor(),
                             "HX710 diagnostics require SENSOR I/O mode");
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL_MESSAGE(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_DIAGNOSTIC),
        "HX710 diagnostics could not acquire sensor ownership");

    esp_err_t setup_result =
        hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
    if (setup_result == ESP_OK) {
        setup_result = initialize_dout_inputs();
    }

    printf("HX710_DIAG,MODE,SENSOR\n");
    printf("HX710_DIAG,SCK_OWNER,%s\n",
           hx710_sck_is_owned_by_sensor() ? "HX710" : "NONE");
    printf("HX710_DIAG,SCK_IDLE,%s\n",
           gpio_get_level(BOARD_HX710_SHARED_SCK) == 0 ? "LOW" : "HIGH");

    hx710_group_result_t result = {0};
    esp_err_t read_result = setup_result == ESP_OK
                                ? run_one_group_read(0, &result)
                                : setup_result;

    esp_err_t low_result =
        hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
    int final_sck = gpio_get_level(BOARD_HX710_SHARED_SCK);
    esp_err_t release_result =
        sensor_owner_release(SENSOR_OWNER_DIAGNOSTIC);
    assert_diagnostic_cleanup(setup_result, read_result, low_result,
                              final_sck, release_result);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.valid_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.post_read_invalid_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.stuck_high_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.stuck_low_mask);
    TEST_ASSERT_EQUAL_UINT8(HX710_READ_PULSE_COUNT,
                            result.pulse_count);
    TEST_ASSERT_EQUAL(ESP_OK, result.cleanup_error);
}

TEST_CASE("test_hx710_repeated_synchronized_group_reads",
          "[hx710_diag][hardware]")
{
    TEST_ASSERT_TRUE_MESSAGE(io_mode_manager_is_sensor(),
                             "HX710 diagnostics require SENSOR I/O mode");
    TEST_ASSERT_EQUAL(ESP_OK, sensor_owner_init());
    TEST_ASSERT_EQUAL_MESSAGE(
        ESP_OK, sensor_owner_acquire(SENSOR_OWNER_DIAGNOSTIC),
        "HX710 diagnostics could not acquire sensor ownership");

    esp_err_t setup_result =
        hx710_sck_acquire_for_sensor_mode(BOARD_HX710_SHARED_SCK);
    if (setup_result == ESP_OK) {
        setup_result = initialize_dout_inputs();
    }

    esp_err_t read_result = setup_result;
    for (unsigned warmup = 0;
         setup_result == ESP_OK && warmup < HX710_DIAG_WARMUP_SAMPLES;
         ++warmup) {
        hx710_group_result_t result;
        (void)run_one_group_read(warmup, &result);
    }

    unsigned successful_reads = 0;
    unsigned attempts = 0;
    while (setup_result == ESP_OK &&
           attempts < HX710_DIAG_MAX_ATTEMPTS &&
           successful_reads < HX710_DIAG_REQUIRED_VALID_READS) {
        hx710_group_result_t result;
        unsigned sample = HX710_DIAG_WARMUP_SAMPLES + attempts;
        esp_err_t attempt_result = run_one_group_read(sample, &result);
        attempts++;
        if (attempt_result == ESP_OK &&
            result.valid_mask == HX710_VALID_CHANNEL_ALL) {
            successful_reads++;
        }
        if (gpio_get_level(BOARD_HX710_SHARED_SCK) != 0) {
            read_result = ESP_FAIL;
            break;
        }
    }
    if (read_result != ESP_FAIL) {
        read_result =
            successful_reads >= HX710_DIAG_REQUIRED_VALID_READS
                ? ESP_OK
                : ESP_ERR_INVALID_RESPONSE;
    }

    printf("HX710_DIAG,REPEATED_RESULT,warmup=%u,attempts=%u,"
           "successful_reads=%u,required=%u\n",
           HX710_DIAG_WARMUP_SAMPLES, attempts, successful_reads,
           HX710_DIAG_REQUIRED_VALID_READS);

    esp_err_t low_result =
        hx710_hold_sck_low(BOARD_HX710_SHARED_SCK);
    int final_sck = gpio_get_level(BOARD_HX710_SHARED_SCK);
    esp_err_t release_result =
        sensor_owner_release(SENSOR_OWNER_DIAGNOSTIC);
    assert_diagnostic_cleanup(setup_result, read_result, low_result,
                              final_sck, release_result);
    TEST_ASSERT_EQUAL_UINT32(HX710_DIAG_REQUIRED_VALID_READS,
                             successful_reads);
}
