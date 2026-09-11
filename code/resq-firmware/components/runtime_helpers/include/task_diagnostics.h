#ifndef TASK_DIAGNOSTICS_H
#define TASK_DIAGNOSTICS_H

#include <stddef.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TASK_STACK_WARNING_BYTES 768u
#define TASK_STACK_CRITICAL_BYTES 384u

typedef struct {
    const char *task_name;
    UBaseType_t minimum_free_words;
    size_t minimum_free_bytes;
} task_stack_watermark_t;

typedef struct {
    size_t free_heap_bytes;
    size_t minimum_free_heap_bytes;
    size_t largest_free_block_bytes;
} firmware_memory_snapshot_t;

void task_diagnostics_record_stack_watermark(const char *task_name);

esp_err_t task_diagnostics_get_stack_watermark(
    const char *task_name,
    task_stack_watermark_t *out);

esp_err_t task_diagnostics_get_memory_snapshot(
    firmware_memory_snapshot_t *out);

#ifdef __cplusplus
}
#endif

#endif
