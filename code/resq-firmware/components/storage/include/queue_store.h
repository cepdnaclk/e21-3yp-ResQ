#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define QUEUE_ITEM_TOPIC_MAX   128
#define QUEUE_ITEM_PAYLOAD_MAX 512
#define QUEUE_STORE_CAPACITY    32

typedef struct {
    char topic_suffix[QUEUE_ITEM_TOPIC_MAX];
    char payload[QUEUE_ITEM_PAYLOAD_MAX];
    int qos;
    int retain;
    uint64_t created_ms;
} queue_item_t;

esp_err_t queue_store_init(void);
esp_err_t queue_store_push(const queue_item_t *item);
esp_err_t queue_store_push_overwrite_oldest(const queue_item_t *item);
esp_err_t queue_store_peek(queue_item_t *out);
esp_err_t queue_store_pop(void);
bool queue_store_is_empty(void);
size_t queue_store_count(void);

#ifdef __cplusplus
}
#endif