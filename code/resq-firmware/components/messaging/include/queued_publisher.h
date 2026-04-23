#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t queued_publisher_init(void);
esp_err_t queued_publisher_start(void);
esp_err_t queued_publisher_publish_or_queue(
    const char *suffix,
    const char *payload,
    int qos,
    int retain
);

#ifdef __cplusplus
}
#endif