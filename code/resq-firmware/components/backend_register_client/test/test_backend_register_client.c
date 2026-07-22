#include <string.h>

#include "backend_register_client.h"
#include "unity.h"

TEST_CASE("Backend registration URL normalizes trailing slashes", "[backend_register]")
{
    char url[256];
    TEST_ASSERT_EQUAL(ESP_OK, backend_register_client_build_url(
        "http://192.0.2.10:18080///", url, sizeof(url)));
    TEST_ASSERT_EQUAL_STRING(
        "http://192.0.2.10:18080/api/devices/register", url);

    TEST_ASSERT_EQUAL(ESP_OK, backend_register_client_build_url(
        "https://hub.example", url, sizeof(url)));
    TEST_ASSERT_EQUAL_STRING(
        "https://hub.example/api/devices/register", url);
}

TEST_CASE("Backend registration request preserves current fields", "[backend_register]")
{
    char body[256];
    TEST_ASSERT_EQUAL(ESP_OK, backend_register_client_build_request_body(
        "A0:B1:C2:D3:E4:F5", body, sizeof(body)));
    TEST_ASSERT_EQUAL_STRING(
        "{\"device_mac\":\"A0:B1:C2:D3:E4:F5\",\"firmware_version\":\"0.1.0\"}",
        body);
    TEST_ASSERT_NULL(strstr(body, "wifi_pass"));
}

TEST_CASE("Backend registration response updates runtime values", "[backend_register]")
{
    backend_registration_result_t result = {0};
    TEST_ASSERT_EQUAL(ESP_OK, backend_register_client_parse_response(
        "{\"ok\":true,\"device_id\":\"M01\",\"mqtt_host\":\"192.0.2.20\","
        "\"mqtt_port\":1883}", &result));
    TEST_ASSERT_EQUAL_STRING("M01", result.device_id);
    TEST_ASSERT_EQUAL_STRING("192.0.2.20", result.mqtt_host);
    TEST_ASSERT_EQUAL_UINT16(1883, result.mqtt_port);
}

TEST_CASE("Invalid backend response is transactional", "[backend_register]")
{
    backend_registration_result_t result = {0};
    strcpy(result.device_id, "existing");
    strcpy(result.mqtt_host, "broker");
    result.mqtt_port = 1883;
    backend_registration_result_t before = result;

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_RESPONSE,
                      backend_register_client_parse_response(
                          "{\"device_id\":\"M02\",\"mqtt_host\":\"broker\"}",
                          &result));
    TEST_ASSERT_EQUAL_MEMORY(&before, &result, sizeof(result));

    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_RESPONSE,
                      backend_register_client_parse_response("not-json", &result));
    TEST_ASSERT_EQUAL_MEMORY(&before, &result, sizeof(result));
}
