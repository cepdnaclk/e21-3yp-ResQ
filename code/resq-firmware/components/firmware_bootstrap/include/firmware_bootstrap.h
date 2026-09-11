#ifndef FIRMWARE_BOOTSTRAP_H
#define FIRMWARE_BOOTSTRAP_H

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define FIRMWARE_BOOTSTRAP_MAX_ENTRIES 32u

typedef enum {
    COMPONENT_CRITICAL = 0,
    COMPONENT_OPTIONAL,
} component_criticality_t;

typedef struct {
    const char *name;
    esp_err_t (*init)(void);
    void (*deinit)(void);
    component_criticality_t criticality;
    bool sensor_mode_only;
} component_bootstrap_entry_t;

typedef struct {
    esp_err_t error;
    const char *component;
    component_criticality_t criticality;
} bootstrap_result_t;

typedef struct {
    bool complete;
    bool initialized[FIRMWARE_BOOTSTRAP_MAX_ENTRIES];
} firmware_bootstrap_context_t;

esp_err_t firmware_bootstrap_run(
    firmware_bootstrap_context_t *context,
    const component_bootstrap_entry_t *entries,
    size_t entry_count,
    bool sensor_mode,
    bootstrap_result_t *out_result);

#ifdef __cplusplus
}
#endif

#endif
