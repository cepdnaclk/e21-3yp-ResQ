#ifndef STATUS_INDICATOR_H
#define STATUS_INDICATOR_H

#include "esp_err.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize LED and buzzer GPIO pins.
 */
esp_err_t status_indicator_init(void);

/**
 * @brief Start the status indicator background task.
 */
esp_err_t status_indicator_start(void);

/**
 * @brief Stop the status indicator task.
 */
void status_indicator_stop(void);

/**
 * @brief Set the current firmware state indication pattern.
 */
void status_indicator_set_state(resq_state_t state);

/**
 * @brief Get the currently indicated firmware state.
 */
resq_state_t status_indicator_get_state(void);

/**
 * @brief Optional short buzzer beep for important events.
 */
void status_indicator_beep_once(void);

#ifdef __cplusplus
}
#endif

#endif /* STATUS_INDICATOR_H */