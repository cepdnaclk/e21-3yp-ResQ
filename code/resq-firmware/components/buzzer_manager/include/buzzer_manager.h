#ifndef BUZZER_MANAGER_H
#define BUZZER_MANAGER_H

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t buzzer_manager_init(void);

esp_err_t buzzer_manager_start_metronome(int target_cpm);

esp_err_t buzzer_manager_stop(void);

bool buzzer_manager_is_running(void);

#ifdef __cplusplus
}
#endif

#endif
