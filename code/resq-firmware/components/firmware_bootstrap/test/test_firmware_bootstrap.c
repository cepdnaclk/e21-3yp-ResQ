#include <string.h>

#include "firmware_bootstrap.h"
#include "unity.h"

static int s_calls[8];
static int s_call_count;
static int s_cleanup[8];
static int s_cleanup_count;
static esp_err_t s_results[8];

#define DEFINE_INIT(index)                         \
    static esp_err_t init_##index(void)            \
    {                                               \
        s_calls[s_call_count++] = index;            \
        return s_results[index];                    \
    }                                               \
    static void deinit_##index(void)                \
    {                                               \
        s_cleanup[s_cleanup_count++] = index;       \
    }

DEFINE_INIT(0)
DEFINE_INIT(1)
DEFINE_INIT(2)
DEFINE_INIT(3)

static void reset_fakes(void)
{
    memset(s_calls, 0, sizeof(s_calls));
    memset(s_cleanup, 0, sizeof(s_cleanup));
    memset(s_results, 0, sizeof(s_results));
    s_call_count = 0;
    s_cleanup_count = 0;
}

static const component_bootstrap_entry_t s_entries[] = {
    {"platform", init_0, deinit_0, COMPONENT_CRITICAL, false},
    {"hx710", init_1, deinit_1, COMPONENT_CRITICAL, true},
    {"optional", init_2, deinit_2, COMPONENT_OPTIONAL, false},
    {"adc", init_3, deinit_3, COMPONENT_CRITICAL, true},
};

TEST_CASE("Firmware bootstrap initializes every component once", "[bootstrap]")
{
    reset_fakes();
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_OK, firmware_bootstrap_run(&context, s_entries,
                                       sizeof(s_entries) / sizeof(s_entries[0]),
                                       true, &result));
    TEST_ASSERT_EQUAL(4, s_call_count);
    TEST_ASSERT_EQUAL(
        ESP_OK, firmware_bootstrap_run(&context, s_entries,
                                       sizeof(s_entries) / sizeof(s_entries[0]),
                                       true, &result));
    TEST_ASSERT_EQUAL(4, s_call_count);
}

TEST_CASE("Firmware bootstrap stops on critical failure", "[bootstrap]")
{
    reset_fakes();
    s_results[1] = ESP_FAIL;
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_FAIL, firmware_bootstrap_run(&context, s_entries,
                                         sizeof(s_entries) / sizeof(s_entries[0]),
                                         true, &result));
    TEST_ASSERT_EQUAL(2, s_call_count);
    TEST_ASSERT_EQUAL_STRING("hx710", result.component);
    TEST_ASSERT_EQUAL(COMPONENT_CRITICAL, result.criticality);
}

TEST_CASE("Firmware bootstrap records optional failure without hiding it",
          "[bootstrap]")
{
    reset_fakes();
    s_results[2] = ESP_FAIL;
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_OK, firmware_bootstrap_run(&context, s_entries,
                                       sizeof(s_entries) / sizeof(s_entries[0]),
                                       true, &result));
    TEST_ASSERT_EQUAL(ESP_FAIL, result.error);
    TEST_ASSERT_EQUAL_STRING("optional", result.component);
    TEST_ASSERT_EQUAL(COMPONENT_OPTIONAL, result.criticality);
    TEST_ASSERT_EQUAL(4, s_call_count);
}

TEST_CASE("Sensor-mode bootstrap acquires HX710 before sensor tasks",
          "[bootstrap][hx710]")
{
    reset_fakes();
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_OK, firmware_bootstrap_run(&context, s_entries,
                                       sizeof(s_entries) / sizeof(s_entries[0]),
                                       true, &result));
    TEST_ASSERT_EQUAL(1, s_calls[1]);
    TEST_ASSERT_EQUAL(3, s_calls[3]);
}

TEST_CASE("USB-mode bootstrap skips sensor-only components",
          "[bootstrap][io_mode]")
{
    reset_fakes();
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_OK, firmware_bootstrap_run(&context, s_entries,
                                       sizeof(s_entries) / sizeof(s_entries[0]),
                                       false, &result));
    TEST_ASSERT_EQUAL(2, s_call_count);
    TEST_ASSERT_EQUAL(0, s_calls[0]);
    TEST_ASSERT_EQUAL(2, s_calls[1]);
}

TEST_CASE("ADC service failure prevents SENSOR runtime start",
          "[bootstrap][sensor]")
{
    reset_fakes();
    s_results[3] = ESP_FAIL;
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_FAIL, firmware_bootstrap_run(&context, s_entries,
                                         sizeof(s_entries) / sizeof(s_entries[0]),
                                         true, &result));
    TEST_ASSERT_FALSE(context.complete);
    TEST_ASSERT_EQUAL_STRING("adc", result.component);
}

TEST_CASE("Partial bootstrap cleanup runs in reverse order", "[bootstrap]")
{
    reset_fakes();
    s_results[3] = ESP_FAIL;
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    TEST_ASSERT_EQUAL(
        ESP_FAIL, firmware_bootstrap_run(&context, s_entries,
                                         sizeof(s_entries) / sizeof(s_entries[0]),
                                         true, &result));
    TEST_ASSERT_EQUAL(3, s_cleanup_count);
    TEST_ASSERT_EQUAL(2, s_cleanup[0]);
    TEST_ASSERT_EQUAL(1, s_cleanup[1]);
    TEST_ASSERT_EQUAL(0, s_cleanup[2]);
}

TEST_CASE("Repeated init does not create duplicate tasks",
          "[bootstrap][lifecycle]")
{
    reset_fakes();
    firmware_bootstrap_context_t context = {0};
    bootstrap_result_t result = {0};
    for (int i = 0; i < 3; ++i) {
        TEST_ASSERT_EQUAL(
            ESP_OK,
            firmware_bootstrap_run(
                &context, s_entries,
                sizeof(s_entries) / sizeof(s_entries[0]), true, &result));
    }
    TEST_ASSERT_EQUAL(4, s_call_count);
}
