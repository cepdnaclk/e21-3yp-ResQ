#include <string.h>

#include "hx710.h"
#include "hx710_test.h"
#include "io_mode_manager.h"
#include "unity.h"

typedef enum {
    DOUT_NORMAL = 0,
    DOUT_ALWAYS_HIGH,
    DOUT_ALWAYS_LOW,
    DOUT_NEXT_READY_TOO_EARLY,
    DOUT_ONE_EARLY_LOW_GLITCH,
    DOUT_TWO_EARLY_LOW_GLITCHES,
    DOUT_NEXT_NEVER_READY,
} dout_behavior_t;

typedef struct {
    int levels[GPIO_NUM_MAX];
    dout_behavior_t behavior[GPIO_NUM_MAX];
    TickType_t initial_ready_at[GPIO_NUM_MAX];
    TickType_t next_ready_after[GPIO_NUM_MAX];
    uint32_t raw[GPIO_NUM_MAX];
    TickType_t ticks;
    TickType_t transaction_completed_at;
    int64_t time_us;
    int64_t transaction_completed_us;
    unsigned cadence_samples[GPIO_NUM_MAX];
    bool post_read_observed[GPIO_NUM_MAX];
    unsigned cycle_pulses;
    unsigned total_high_attempts;
    unsigned completed_transactions;
    unsigned reset_calls;
    unsigned config_calls;
    unsigned set_calls;
    unsigned low_calls;
    unsigned task_delay_calls;
    unsigned fail_on_high_attempt;
    unsigned fail_on_low_call;
    bool transaction_complete;
    bool fail_config;
    bool sck_stuck_high;
    gpio_config_t last_config;
} fake_io_t;

static fake_io_t fake;

static esp_err_t fake_reset(gpio_num_t pin)
{
    fake.reset_calls++;
    fake.levels[pin] = 0;
    return ESP_OK;
}

static esp_err_t fake_config(const gpio_config_t *config)
{
    fake.config_calls++;
    fake.last_config = *config;
    return fake.fail_config ? ESP_FAIL : ESP_OK;
}

static bool all_normal_channels_ready_for_next(void)
{
    const gpio_num_t pins[3] = {GPIO_NUM_1, GPIO_NUM_3, GPIO_NUM_10};
    TickType_t elapsed = fake.ticks - fake.transaction_completed_at;
    for (size_t i = 0; i < 3; ++i) {
        gpio_num_t pin = pins[i];
        if (fake.behavior[pin] == DOUT_NEXT_NEVER_READY) {
            return false;
        }
        if (fake.behavior[pin] != DOUT_ALWAYS_LOW &&
            elapsed < fake.next_ready_after[pin]) {
            return false;
        }
    }
    return true;
}

static esp_err_t fake_set(gpio_num_t pin, uint32_t level)
{
    fake.set_calls++;
    if (pin != GPIO_NUM_19) {
        fake.levels[pin] = (int)level;
        return ESP_OK;
    }

    if (level == 0) {
        fake.low_calls++;
        if (fake.fail_on_low_call != 0 &&
            fake.low_calls == fake.fail_on_low_call) {
            return ESP_FAIL;
        }
        fake.levels[pin] = 0;
        return ESP_OK;
    }

    fake.total_high_attempts++;
    if (fake.fail_on_high_attempt != 0 &&
        fake.total_high_attempts == fake.fail_on_high_attempt) {
        return ESP_FAIL;
    }

    if (fake.transaction_complete && all_normal_channels_ready_for_next()) {
        fake.transaction_complete = false;
        fake.cycle_pulses = 0;
    }
    fake.levels[pin] = 1;
    fake.cycle_pulses++;
    if (fake.cycle_pulses == HX710_READ_PULSE_COUNT) {
        fake.transaction_complete = true;
        fake.transaction_completed_at = fake.ticks;
        fake.transaction_completed_us = fake.time_us;
        memset(fake.cadence_samples, 0, sizeof(fake.cadence_samples));
        memset(fake.post_read_observed, 0,
               sizeof(fake.post_read_observed));
        fake.completed_transactions++;
    }
    return ESP_OK;
}

static int normal_dout_level(gpio_num_t pin)
{
    if (fake.transaction_complete) {
        TickType_t elapsed = fake.ticks - fake.transaction_completed_at;
        return elapsed >= fake.next_ready_after[pin] ? 0 : 1;
    }
    if (fake.levels[GPIO_NUM_19] == 1 &&
        fake.cycle_pulses >= 1 &&
        fake.cycle_pulses <= 24) {
        unsigned shift = 24u - fake.cycle_pulses;
        return (int)((fake.raw[pin] >> shift) & 1u);
    }
    return fake.ticks >= fake.initial_ready_at[pin] ? 0 : 1;
}

static int fake_get(gpio_num_t pin)
{
    if (pin == GPIO_NUM_19) {
        return fake.sck_stuck_high ? 1 : fake.levels[pin];
    }
    switch (fake.behavior[pin]) {
    case DOUT_ALWAYS_HIGH:
        return 1;
    case DOUT_ALWAYS_LOW:
        return 0;
    case DOUT_NEXT_READY_TOO_EARLY:
    case DOUT_ONE_EARLY_LOW_GLITCH:
    case DOUT_TWO_EARLY_LOW_GLITCHES:
        if (fake.transaction_complete) {
            if (!fake.post_read_observed[pin]) {
                fake.post_read_observed[pin] = true;
                return 1;
            }
            fake.cadence_samples[pin]++;
            if (fake.behavior[pin] == DOUT_NEXT_READY_TOO_EARLY) {
                return 0;
            }
            unsigned glitch_samples =
                fake.behavior[pin] == DOUT_ONE_EARLY_LOW_GLITCH
                    ? 1u
                    : 2u;
            if (fake.cadence_samples[pin] <= glitch_samples) {
                return 0;
            }
        }
        return normal_dout_level(pin);
    case DOUT_NEXT_NEVER_READY:
        if (fake.transaction_complete) {
            fake.post_read_observed[pin] = true;
            return 1;
        }
        return normal_dout_level(pin);
    case DOUT_NORMAL:
    default:
        if (fake.transaction_complete &&
            !fake.post_read_observed[pin]) {
            fake.post_read_observed[pin] = true;
            return 1;
        }
        return normal_dout_level(pin);
    }
}

static void fake_delay_us(uint32_t delay_us)
{
    fake.time_us += delay_us;
}

static int64_t fake_get_time_us(void)
{
    return fake.time_us;
}

static TickType_t fake_ticks(void)
{
    return fake.ticks;
}

static void fake_task_delay(TickType_t ticks)
{
    fake.task_delay_calls++;
    TickType_t elapsed_ticks = ticks > 0 ? ticks : 1;
    fake.ticks += elapsed_ticks;
    fake.time_us +=
        (int64_t)elapsed_ticks * portTICK_PERIOD_MS * 1000;
}

static void install_fake(void)
{
    memset(&fake, 0, sizeof(fake));
    fake.next_ready_after[GPIO_NUM_1] = pdMS_TO_TICKS(100);
    fake.next_ready_after[GPIO_NUM_3] = pdMS_TO_TICKS(100);
    fake.next_ready_after[GPIO_NUM_10] = pdMS_TO_TICKS(100);
    fake.raw[GPIO_NUM_1] = 0x000001u;
    fake.raw[GPIO_NUM_3] = 0x123456u;
    fake.raw[GPIO_NUM_10] = 0xfffffeu;

    hx710_test_io_ops_t ops = {
        .reset_pin = fake_reset,
        .config = fake_config,
        .set_level = fake_set,
        .get_level = fake_get,
        .delay_us = fake_delay_us,
        .get_time_us = fake_get_time_us,
        .get_tick_count = fake_ticks,
        .task_delay = fake_task_delay,
    };
    hx710_reset_state_for_test();
    TEST_ASSERT_EQUAL(ESP_OK, hx710_set_test_io_ops(&ops));
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);
}

static void uninstall_fake(void)
{
    hx710_reset_state_for_test();
    hx710_reset_test_io_ops();
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);
}

static void acquire_sck(void)
{
    TEST_ASSERT_EQUAL(ESP_OK,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));
}

TEST_CASE("HX710 acquires shared SCK once without GPIO reset", "[hx710]")
{
    install_fake();
    acquire_sck();
    unsigned first_config_calls = fake.config_calls;
    unsigned first_low_calls = fake.low_calls;

    TEST_ASSERT_EQUAL(ESP_OK,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));

    TEST_ASSERT_TRUE(hx710_sck_is_owned_by_sensor());
    TEST_ASSERT_EQUAL_UINT32(0, fake.reset_calls);
    TEST_ASSERT_EQUAL_UINT32(first_config_calls, fake.config_calls);
    TEST_ASSERT_TRUE(fake.low_calls > first_low_calls);
    TEST_ASSERT_EQUAL(GPIO_MODE_OUTPUT, fake.last_config.mode);
    TEST_ASSERT_EQUAL(GPIO_PULLUP_DISABLE, fake.last_config.pull_up_en);
    TEST_ASSERT_EQUAL(GPIO_PULLDOWN_DISABLE, fake.last_config.pull_down_en);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 acquisition reports GPIO failures", "[hx710]")
{
    install_fake();
    fake.fail_config = true;
    TEST_ASSERT_EQUAL(ESP_FAIL,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));

    fake.fail_config = false;
    fake.sck_stuck_high = true;
    TEST_ASSERT_EQUAL(ESP_FAIL,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));
    TEST_ASSERT_FALSE(hx710_sck_is_owned_by_sensor());
    uninstall_fake();
}

TEST_CASE("HX710 group all-ready read is synchronized and valid", "[hx710]")
{
    install_fake();
    acquire_sck();
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.valid_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.ready_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.observed_next_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.early_next_ready_warning_mask);
    TEST_ASSERT_EQUAL_UINT8(HX710_READ_PULSE_COUNT, result.pulse_count);
    TEST_ASSERT_EQUAL_INT32(1, result.raw[0]);
    TEST_ASSERT_EQUAL_INT32(0x123456, result.raw[1]);
    TEST_ASSERT_EQUAL_INT32(-2, result.raw[2]);
    TEST_ASSERT_EQUAL_UINT32(1, fake.completed_transactions);
    TEST_ASSERT_EQUAL_UINT32(0, fake.task_delay_calls);
    TEST_ASSERT_EQUAL_UINT32(0, fake.ticks);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 partial readiness times out without clocking", "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_1] = DOUT_ALWAYS_HIGH;
    fake.behavior[GPIO_NUM_10] = DOUT_ALWAYS_HIGH;
    int32_t out0 = 101;
    int32_t out1 = 202;
    int32_t out2 = 303;
    uint8_t valid_mask = 0xff;

    TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT, hx710_read_3_shared_sck_valid(
                                                  GPIO_NUM_19, GPIO_NUM_1,
                                                  GPIO_NUM_3, GPIO_NUM_10,
                                                  &out0, &out1, &out2,
                                                  &valid_mask));

    TEST_ASSERT_EQUAL_UINT32(0, fake.total_high_attempts);
    TEST_ASSERT_EQUAL_HEX8(0, valid_mask);
    TEST_ASSERT_EQUAL_INT32(101, out0);
    TEST_ASSERT_EQUAL_INT32(202, out1);
    TEST_ASSERT_EQUAL_INT32(303, out2);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 timeout identifies the DOUT that stayed HIGH", "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_10] = DOUT_ALWAYS_HIGH;
    hx710_group_result_t result = {
        .raw = {101, 202, 303},
    };

    TEST_ASSERT_EQUAL(ESP_ERR_TIMEOUT, hx710_read_group_shared_sck(
                                           GPIO_NUM_19, GPIO_NUM_1,
                                           GPIO_NUM_3, GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_2, result.not_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_2, result.stuck_high_mask);
    TEST_ASSERT_EQUAL_UINT8(0, result.pulse_count);
    TEST_ASSERT_EQUAL_UINT32(0, fake.total_high_attempts);
    TEST_ASSERT_EQUAL_INT32(101, result.raw[0]);
    TEST_ASSERT_EQUAL_INT32(202, result.raw[1]);
    TEST_ASSERT_EQUAL_INT32(303, result.raw[2]);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 stuck LOW fails post-read validation", "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_3] = DOUT_ALWAYS_LOW;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_RESPONSE,
                      hx710_read_group_shared_sck(
                          GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                          GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_1, result.stuck_low_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_1,
                           result.post_read_invalid_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.valid_mask);
    TEST_ASSERT_EQUAL_UINT8(HX710_READ_PULSE_COUNT, result.pulse_count);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 early next readiness does not invalidate completed sample",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_1] = DOUT_NEXT_READY_TOO_EARLY;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_0,
                           result.observed_next_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(
        HX710_VALID_CHANNEL_0,
        result.early_next_ready_warning_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.valid_mask);
    TEST_ASSERT_EQUAL(ESP_OK, result.cleanup_error);
    TEST_ASSERT_EQUAL_INT32(1, result.raw[0]);
    TEST_ASSERT_EQUAL_UINT32(0, fake.task_delay_calls);
    TEST_ASSERT_EQUAL_UINT32(0, fake.ticks);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 early next readiness on multiple channels stays valid",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_1] = DOUT_NEXT_READY_TOO_EARLY;
    fake.behavior[GPIO_NUM_10] = DOUT_NEXT_READY_TOO_EARLY;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    const uint8_t expected_warning =
        HX710_VALID_CHANNEL_0 | HX710_VALID_CHANNEL_2;
    TEST_ASSERT_EQUAL_HEX8(expected_warning,
                           result.observed_next_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(
        expected_warning, result.early_next_ready_warning_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.valid_mask);
    TEST_ASSERT_EQUAL_UINT32(0, fake.task_delay_calls);
    uninstall_fake();
}

TEST_CASE("HX710 next-ready warning masks are independent by channel",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_3] = DOUT_NEXT_READY_TOO_EARLY;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_1,
                           result.observed_next_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(
        HX710_VALID_CHANNEL_1,
        result.early_next_ready_warning_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.valid_mask);
    uninstall_fake();
}

TEST_CASE("HX710 valid wrapper publishes an early-next sample", "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_10] = DOUT_NEXT_READY_TOO_EARLY;
    int32_t out0 = 101;
    int32_t out1 = 202;
    int32_t out2 = 303;
    uint8_t valid_mask = 0;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_3_shared_sck_valid(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &out0, &out1, &out2,
                                  &valid_mask));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, valid_mask);
    TEST_ASSERT_EQUAL_INT32(1, out0);
    TEST_ASSERT_EQUAL_INT32(0x123456, out1);
    TEST_ASSERT_EQUAL_INT32(-2, out2);
    uninstall_fake();
}

TEST_CASE("HX710 next readiness wait is deferred to the next read",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.behavior[GPIO_NUM_10] = DOUT_NEXT_NEVER_READY;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(0, result.not_ready_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.stuck_high_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, result.valid_mask);
    TEST_ASSERT_EQUAL_UINT8(HX710_READ_PULSE_COUNT,
                            result.pulse_count);
    TEST_ASSERT_EQUAL(ESP_OK, result.cleanup_error);
    TEST_ASSERT_EQUAL_UINT32(0, fake.task_delay_calls);
    TEST_ASSERT_EQUAL_UINT32(0, fake.ticks);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 midway clock failure cleans up without outputs", "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.fail_on_high_attempt = 8;
    int32_t out0 = 11;
    int32_t out1 = 22;
    int32_t out2 = 33;
    uint8_t valid_mask = 0xff;

    TEST_ASSERT_EQUAL(ESP_FAIL, hx710_read_3_shared_sck_valid(
                                        GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                        GPIO_NUM_10, &out0, &out1, &out2,
                                        &valid_mask));

    TEST_ASSERT_EQUAL_HEX8(0, valid_mask);
    TEST_ASSERT_EQUAL_INT32(11, out0);
    TEST_ASSERT_EQUAL_INT32(22, out1);
    TEST_ASSERT_EQUAL_INT32(33, out2);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 SCK cleanup failure overrides successful capture",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    fake.fail_on_low_call =
        fake.low_calls + HX710_READ_PULSE_COUNT + 2u;
    hx710_group_result_t result;

    TEST_ASSERT_EQUAL(ESP_FAIL, hx710_read_group_shared_sck(
                                    GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                    GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL,
                           result.captured_raw_mask);
    TEST_ASSERT_EQUAL_HEX8(0, result.valid_mask);
    TEST_ASSERT_EQUAL_UINT8(HX710_READ_PULSE_COUNT,
                            result.pulse_count);
    TEST_ASSERT_EQUAL(ESP_FAIL, result.cleanup_error);
    uninstall_fake();
}

TEST_CASE("HX710 repeated reads keep SCK LOW between transactions", "[hx710]")
{
    install_fake();
    acquire_sck();
    hx710_group_result_t first;
    hx710_group_result_t second;

    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &first));
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &second));

    TEST_ASSERT_EQUAL_UINT32(2, fake.completed_transactions);
    TEST_ASSERT_EQUAL_HEX8(HX710_VALID_CHANNEL_ALL, second.valid_mask);
    TEST_ASSERT_EQUAL_INT(0, fake.levels[GPIO_NUM_19]);
    uninstall_fake();
}

TEST_CASE("HX710 normal transaction never resets the owned shared SCK",
          "[hx710]")
{
    install_fake();
    acquire_sck();
    TEST_ASSERT_EQUAL(ESP_OK, hx710_init(GPIO_NUM_19, GPIO_NUM_1));
    TEST_ASSERT_EQUAL(ESP_OK, hx710_init(GPIO_NUM_19, GPIO_NUM_3));
    TEST_ASSERT_EQUAL(ESP_OK, hx710_init(GPIO_NUM_19, GPIO_NUM_10));
    hx710_group_result_t result;
    TEST_ASSERT_EQUAL(ESP_OK, hx710_read_group_shared_sck(
                                  GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                                  GPIO_NUM_10, &result));

    TEST_ASSERT_EQUAL_UINT32(0, fake.reset_calls);
    uninstall_fake();
}

TEST_CASE("HX710 single-DOUT clocking fails closed", "[hx710]")
{
    install_fake();
    acquire_sck();
    int32_t raw = 77;
    uint32_t wait_ms = 99;
    uint8_t pulses = 99;

    TEST_ASSERT_EQUAL(ESP_ERR_NOT_SUPPORTED,
                      hx710_read_single(GPIO_NUM_19, GPIO_NUM_1, &raw,
                                        &wait_ms, &pulses));

    TEST_ASSERT_EQUAL_INT32(77, raw);
    TEST_ASSERT_EQUAL_UINT32(0, wait_ms);
    TEST_ASSERT_EQUAL_UINT8(0, pulses);
    TEST_ASSERT_EQUAL_UINT32(0, fake.total_high_attempts);
    uninstall_fake();
}

TEST_CASE("USB mode rejects HX710 before touching GPIO", "[hx710][io_mode]")
{
    install_fake();
    io_mode_manager_set_for_test(RESQ_IO_MODE_USB);
    hx710_group_result_t result;
    esp_err_t acquire_result =
        hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19);
    esp_err_t read_result = hx710_read_group_shared_sck(
        GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3, GPIO_NUM_10, &result);

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, acquire_result);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, read_result);
    TEST_ASSERT_EQUAL_UINT32(0, fake.config_calls);
    TEST_ASSERT_EQUAL_UINT32(0, fake.set_calls);
    uninstall_fake();
}

TEST_CASE("HX710 ownership transfers only through explicit release",
          "[hx710][io_mode]")
{
    install_fake();
    acquire_sck();
    TEST_ASSERT_TRUE(hx710_sck_is_owned_by_sensor());

    TEST_ASSERT_EQUAL(ESP_OK, hx710_sck_release_for_usb_mode());
    TEST_ASSERT_FALSE(hx710_sck_is_owned_by_sensor());
    TEST_ASSERT_EQUAL(GPIO_MODE_INPUT, fake.last_config.mode);

    hx710_group_result_t result;
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      hx710_read_group_shared_sck(
                          GPIO_NUM_19, GPIO_NUM_1, GPIO_NUM_3,
                          GPIO_NUM_10, &result));

    io_mode_manager_set_for_test(RESQ_IO_MODE_USB);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));
    io_mode_manager_set_for_test(RESQ_IO_MODE_SENSOR);
    TEST_ASSERT_EQUAL(ESP_OK,
                      hx710_sck_acquire_for_sensor_mode(GPIO_NUM_19));
    uninstall_fake();
}

TEST_CASE("HX710 build disables native USB Serial JTAG console",
          "[hx710][config]")
{
#if (defined(CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG) && \
     CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG) || \
    (defined(CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG) && \
     CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG)
    TEST_FAIL_MESSAGE(
        "Native USB Serial/JTAG console conflicts with HX710 USB-pad protection");
#else
    TEST_PASS();
#endif
}
