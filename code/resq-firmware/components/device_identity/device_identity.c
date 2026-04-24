#include "device_identity.h"

#include <stdio.h>
#include <string.h>

#include "esp_app_desc.h"
#include "esp_chip_info.h"
#include "esp_mac.h"
#include "esp_system.h"

static device_identity_info_t s_info;

static const char *chip_model_string(esp_chip_model_t model)
{
    switch (model) {
        case CHIP_ESP32:   return "ESP32";
        case CHIP_ESP32S2: return "ESP32-S2";
        case CHIP_ESP32S3: return "ESP32-S3";
        case CHIP_ESP32C3: return "ESP32-C3";
        case CHIP_ESP32C2: return "ESP32-C2";
        case CHIP_ESP32C6: return "ESP32-C6";
        case CHIP_ESP32H2: return "ESP32-H2";
        case CHIP_ESP32P4: return "ESP32-P4";
        default:           return "UNKNOWN";
    }
}

esp_err_t device_identity_init(const char *device_id, const char *manikin_id)
{
    memset(&s_info, 0, sizeof(s_info));

    snprintf(s_info.device_id, sizeof(s_info.device_id), "%s", device_id ? device_id : "");
    snprintf(s_info.manikin_id, sizeof(s_info.manikin_id), "%s", manikin_id ? manikin_id : "");

    snprintf(s_info.hardware_revision, sizeof(s_info.hardware_revision), "%s", "revA");
    snprintf(s_info.build_date, sizeof(s_info.build_date), "%s", __DATE__);
    snprintf(s_info.build_time, sizeof(s_info.build_time), "%s", __TIME__);

    const esp_app_desc_t *app_desc = esp_app_get_description();
    if (app_desc && app_desc->version[0] != '\0') {
        snprintf(s_info.firmware_version, sizeof(s_info.firmware_version), "%s", app_desc->version);
    } else {
        snprintf(s_info.firmware_version, sizeof(s_info.firmware_version), "%s", "unknown");
    }

    esp_chip_info_t chip_info;
    esp_chip_info(&chip_info);

    snprintf(s_info.chip_model, sizeof(s_info.chip_model), "%s", chip_model_string(chip_info.model));
    s_info.chip_cores = chip_info.cores;
    s_info.chip_revision = chip_info.revision;

    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(
        s_info.mac_address,
        sizeof(s_info.mac_address),
        "%02X:%02X:%02X:%02X:%02X:%02X",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    );

    s_info.reset_reason = (int)esp_reset_reason();

    return ESP_OK;
}

esp_err_t device_identity_get(device_identity_info_t *out)
{
    if (out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    *out = s_info;
    return ESP_OK;
}