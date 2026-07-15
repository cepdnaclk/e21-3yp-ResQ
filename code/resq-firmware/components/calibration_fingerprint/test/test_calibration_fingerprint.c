#include "unity.h"
#include "calibration_fingerprint.h"
#include <string.h>

TEST_CASE("Calibration fingerprint matches known-answer vector", "[fingerprint]")
{
    char hash[65];
    esp_err_t err = calibration_fingerprint_calculate(
        "adult-basic",
        1,
        13500,
        20100,
        15000,
        15000,
        hash,
        sizeof(hash)
    );
    
    TEST_ASSERT_EQUAL(ESP_OK, err);
    TEST_ASSERT_EQUAL_STRING("d9c9747c1ede10bf156a16e33f67f39bc21694d42fc91a35be50df7d7e24ca4a", hash);
}

TEST_CASE("Calibration fingerprint returns invalid arg on short buffer", "[fingerprint]")
{
    char hash[64]; // Too small (needs at least 65 bytes)
    esp_err_t err = calibration_fingerprint_calculate(
        "adult-basic",
        1,
        13500,
        20100,
        15000,
        15000,
        hash,
        sizeof(hash)
    );
    
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, err);
}
