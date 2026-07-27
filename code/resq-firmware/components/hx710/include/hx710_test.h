#pragma once

#include "hx710.h"
#include "freertos/FreeRTOS.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Test-only GPIO/timing seam used by the HX710 Unity component tests. */
typedef struct {
    esp_err_t (*reset_pin)(gpio_num_t pin);
    esp_err_t (*config)(const gpio_config_t *config);
    esp_err_t (*set_level)(gpio_num_t pin, uint32_t level);
    int (*get_level)(gpio_num_t pin);
    void (*delay_us)(uint32_t delay_us);
    int64_t (*get_time_us)(void);
    TickType_t (*get_tick_count)(void);
    void (*task_delay)(TickType_t ticks);
} hx710_test_io_ops_t;

esp_err_t hx710_set_test_io_ops(const hx710_test_io_ops_t *ops);
void hx710_reset_test_io_ops(void);
void hx710_reset_state_for_test(void);

#ifdef __cplusplus
}
#endif
