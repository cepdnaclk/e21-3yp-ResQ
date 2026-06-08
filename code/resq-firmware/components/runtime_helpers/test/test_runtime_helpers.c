#include "runtime_helpers.h"
#include "unity.h"

TEST_CASE("Request ID parser accepts command_id and request_id", "[mqtt]")
{
    char id[32];
    TEST_ASSERT_EQUAL(ESP_OK,
                      resq_command_extract_request_id(
                          "{\"command_id\":\"cmd-1\"}", id, sizeof(id)));
    TEST_ASSERT_EQUAL_STRING("cmd-1", id);
    TEST_ASSERT_EQUAL(ESP_OK,
                      resq_command_extract_request_id(
                          "{\"request_id\":\"req-2\"}", id, sizeof(id)));
    TEST_ASSERT_EQUAL_STRING("req-2", id);
}

TEST_CASE("Request ID parser rejects malformed missing and oversized IDs", "[mqtt]")
{
    char id[8];
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG,
                      resq_command_extract_request_id(NULL, id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      resq_command_extract_request_id("{bad", id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_NOT_FOUND,
                      resq_command_extract_request_id("{}", id, sizeof(id)));
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_SIZE,
                      resq_command_extract_request_id(
                          "{\"command_id\":\"too-long-id\"}", id, sizeof(id)));
}
