#include "calibration_fingerprint.h"
#include "psa/crypto.h"
#include <string.h>
#include <stdio.h>

esp_err_t calibration_fingerprint_calculate(
    const char *profile_id,
    uint32_t profile_version,
    int32_t hall_delta,
    int32_t ref_pressure,
    int32_t bladder_1_pressure,
    int32_t bladder_2_pressure,
    char *out_hash,
    size_t max_len
) {
    if (profile_id == NULL || out_hash == NULL || max_len < 65) {
        return ESP_ERR_INVALID_ARG;
    }

    // Format target canonical string
    // Format: profile_id={id};profile_version={version};hall_delta={hall};ref_pressure={ref};bladder_1_pressure={b1};bladder_2_pressure={b2}
    // Must be base-10 integers, no trimming, no newline, no null terminator in hashed data.
    char canonical_buf[512];
    int written = snprintf(
        canonical_buf, sizeof(canonical_buf),
        "profile_id=%s;profile_version=%u;hall_delta=%ld;ref_pressure=%ld;bladder_1_pressure=%ld;bladder_2_pressure=%ld",
        profile_id,
        (unsigned int)profile_version,
        (long)hall_delta,
        (long)ref_pressure,
        (long)bladder_1_pressure,
        (long)bladder_2_pressure
    );

    if (written < 0 || (size_t)written >= sizeof(canonical_buf)) {
        // Reject canonical-buffer truncation
        return ESP_ERR_INVALID_ARG;
    }

    // Initialize PSA Crypto (safe/idempotent to call multiple times)
    psa_status_t status = psa_crypto_init();
    if (status != PSA_SUCCESS) {
        return ESP_FAIL;
    }

    uint8_t digest[32];
    size_t digest_len = 0;
    status = psa_hash_compute(
        PSA_ALG_SHA_256,
        (const uint8_t *)canonical_buf,
        (size_t)written,
        digest,
        sizeof(digest),
        &digest_len
    );

    if (status != PSA_SUCCESS || digest_len != 32) {
        return ESP_FAIL;
    }

    // Output exactly 64 lowercase hexadecimal characters
    for (int i = 0; i < 32; i++) {
        sprintf(&out_hash[i * 2], "%02x", digest[i]);
    }
    out_hash[64] = '\0';

    return ESP_OK;
}
