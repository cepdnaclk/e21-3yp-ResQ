#include "firmware_bootstrap.h"

#include <string.h>

#include "esp_log.h"

static const char *TAG = "firmware_bootstrap";

static void cleanup_reverse(firmware_bootstrap_context_t *context,
                            const component_bootstrap_entry_t *entries,
                            size_t failed_index)
{
    for (size_t i = failed_index; i > 0; --i) {
        size_t index = i - 1;
        if (!context->initialized[index]) {
            continue;
        }
        if (entries[index].deinit != NULL) {
            entries[index].deinit();
        }
        context->initialized[index] = false;
    }
}

esp_err_t firmware_bootstrap_run(
    firmware_bootstrap_context_t *context,
    const component_bootstrap_entry_t *entries,
    size_t entry_count,
    bool sensor_mode,
    bootstrap_result_t *out_result)
{
    if (context == NULL || entries == NULL || out_result == NULL ||
        entry_count == 0 ||
        entry_count > FIRMWARE_BOOTSTRAP_MAX_ENTRIES) {
        return ESP_ERR_INVALID_ARG;
    }
    if (context->complete) {
        *out_result = (bootstrap_result_t) {
            .error = ESP_OK,
            .criticality = COMPONENT_CRITICAL,
        };
        return ESP_OK;
    }

    memset(context->initialized, 0, sizeof(context->initialized));
    *out_result = (bootstrap_result_t) {
        .error = ESP_OK,
        .criticality = COMPONENT_CRITICAL,
    };

    for (size_t i = 0; i < entry_count; ++i) {
        const component_bootstrap_entry_t *entry = &entries[i];
        if (entry->sensor_mode_only && !sensor_mode) {
            continue;
        }
        if (entry->name == NULL || entry->init == NULL) {
            cleanup_reverse(context, entries, i);
            return ESP_ERR_INVALID_ARG;
        }

        esp_err_t err = entry->init();
        if (err == ESP_OK) {
            context->initialized[i] = true;
            continue;
        }

        ESP_LOG_LEVEL(entry->criticality == COMPONENT_CRITICAL
                          ? ESP_LOG_ERROR
                          : ESP_LOG_WARN,
                      TAG, "component=%s init failed: %s",
                      entry->name, esp_err_to_name(err));
        if (out_result->error == ESP_OK) {
            out_result->error = err;
            out_result->component = entry->name;
            out_result->criticality = entry->criticality;
        }
        if (entry->criticality == COMPONENT_CRITICAL) {
            cleanup_reverse(context, entries, i);
            return err;
        }
    }

    context->complete = true;
    return ESP_OK;
}
