#ifndef ADC_SHARED_SERVICE_H
#define ADC_SHARED_SERVICE_H

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t adc_shared_service_init(void);

esp_err_t adc_shared_service_read_hall_raw(int *out_raw);

esp_err_t adc_shared_service_read_hall_mv(int *out_mv);

esp_err_t adc_shared_service_read_hall_average(int sample_count, int delay_ms, int *out_avg);

bool adc_shared_service_is_initialized(void);

esp_err_t adc_shared_service_deinit(void);

#ifdef __cplusplus
}
#endif

#endif
