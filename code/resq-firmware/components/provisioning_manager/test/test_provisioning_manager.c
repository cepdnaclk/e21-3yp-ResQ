#include <stdio.h>
#include <string.h>

#include "provisioning_manager.h"
#include "unity.h"

TEST_CASE("Provisioning page maps canonical QR fields and aliases", "[provisioning][qr]")
{
    const char *html = provisioning_manager_get_page_html();
    TEST_ASSERT_NOT_NULL(html);
    TEST_ASSERT_NOT_NULL(strstr(html, "new URLSearchParams(window.location.search)"));
    TEST_ASSERT_NOT_NULL(strstr(html, "wifi_ssid: ['wifi_ssid','ssid']"));
    TEST_ASSERT_NOT_NULL(strstr(html,
                                "wifi_pass: ['wifi_pass','wifi_password','password']"));
    TEST_ASSERT_NOT_NULL(strstr(html,
                                "backend_base_url: ['backend_base_url','backend_url','hub_url']"));
    TEST_ASSERT_NOT_NULL(strstr(html, "params.has(aliases[i])"));
    TEST_ASSERT_NOT_NULL(strstr(html, "el.value = params.get(aliases[i])"));
}

TEST_CASE("Provisioning password field stays masked optional and editable", "[provisioning][qr]")
{
    const char *html = provisioning_manager_get_page_html();
    TEST_ASSERT_NOT_NULL(strstr(
        html,
        "<input id='wifi_pass' name='wifi_pass' type='password' autocomplete='current-password'>"));
    TEST_ASSERT_NULL(strstr(html, "console."));
    TEST_ASSERT_NOT_NULL(strstr(
        html, "wifi_pass: document.getElementById('wifi_pass').value"));
}

TEST_CASE("Provisioning accepts empty and nonempty passwords", "[provisioning]")
{
    network_config_t config;
    network_config_set_defaults(&config);

    TEST_ASSERT_EQUAL(ESP_OK, provisioning_manager_parse_payload(
        "{\"wifi_ssid\":\"ResQ Lab\",\"wifi_pass\":\"\","
        "\"backend_base_url\":\"http://192.0.2.10:18080\"}", &config));
    TEST_ASSERT_EQUAL_STRING("", config.wifi_pass);
    TEST_ASSERT_TRUE(network_config_validate(&config));

    TEST_ASSERT_EQUAL(ESP_OK, provisioning_manager_parse_payload(
        "{\"wifi_ssid\":\"ResQ Lab\",\"wifi_pass\":\"p@ss&word=123\","
        "\"backend_base_url\":\"http://192.0.2.10:18080\"}", &config));
    TEST_ASSERT_EQUAL_STRING("p@ss&word=123", config.wifi_pass);
    TEST_ASSERT_TRUE(network_config_validate(&config));
}

TEST_CASE("Provisioning preserves special form password characters", "[provisioning]")
{
    network_config_t config;
    network_config_set_defaults(&config);
    TEST_ASSERT_EQUAL(ESP_OK, provisioning_manager_parse_payload(
        "wifi_ssid=ResQ+Lab&wifi_pass=p%40ss%26word%3D123%2B%25%23%3F+quoted&"
        "backend_base_url=http%3A%2F%2F192.0.2.10%3A18080", &config));
    TEST_ASSERT_EQUAL_STRING("ResQ Lab", config.wifi_ssid);
    TEST_ASSERT_EQUAL_STRING("p@ss&word=123+%#? quoted", config.wifi_pass);
}

TEST_CASE("Provisioning password boundary is safe and transactional", "[provisioning]")
{
    char maximum_password[RESQ_WIFI_PASS_MAX_LEN];
    memset(maximum_password, 'x', sizeof(maximum_password) - 1);
    maximum_password[sizeof(maximum_password) - 1] = '\0';

    char body[300];
    snprintf(body, sizeof(body),
             "{\"wifi_ssid\":\"ResQ\",\"wifi_pass\":\"%s\","
             "\"backend_base_url\":\"http://192.0.2.10\"}",
             maximum_password);

    network_config_t config;
    network_config_set_defaults(&config);
    TEST_ASSERT_EQUAL(ESP_OK,
                      provisioning_manager_parse_payload(body, &config));
    TEST_ASSERT_EQUAL_STRING(maximum_password, config.wifi_pass);

    char overlong_password[RESQ_WIFI_PASS_MAX_LEN + 1];
    memset(overlong_password, 'y', sizeof(overlong_password) - 1);
    overlong_password[sizeof(overlong_password) - 1] = '\0';
    snprintf(body, sizeof(body),
             "{\"wifi_ssid\":\"ResQ\",\"wifi_pass\":\"%s\","
             "\"backend_base_url\":\"http://192.0.2.10\"}",
             overlong_password);

    network_config_t before = config;
    TEST_ASSERT_NOT_EQUAL(ESP_OK,
                          provisioning_manager_parse_payload(body, &config));
    TEST_ASSERT_EQUAL_MEMORY(&before, &config, sizeof(config));

    TEST_ASSERT_NOT_EQUAL(ESP_OK, provisioning_manager_parse_payload(
        "wifi_ssid=ResQ&wifi_pass=bad%GG&backend_base_url=http%3A%2F%2Fhub",
        &config));
    TEST_ASSERT_EQUAL_MEMORY(&before, &config, sizeof(config));
}
