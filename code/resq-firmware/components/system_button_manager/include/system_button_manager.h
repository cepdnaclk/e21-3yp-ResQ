#ifndef SYSTEM_BUTTON_MANAGER_H
#define SYSTEM_BUTTON_MANAGER_H

#include <stdint.h>
#include <stdbool.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "states.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    SYSTEM_BUTTON_ID_NONE = 0,
    SYSTEM_BUTTON_ID_1,
    SYSTEM_BUTTON_ID_2
} system_button_id_t;

typedef enum {
    SYSTEM_BUTTON_PRESS_NONE = 0,
    SYSTEM_BUTTON_PRESS_SHORT,
    SYSTEM_BUTTON_PRESS_LONG
} system_button_press_type_t;

typedef enum {
    SYSTEM_BUTTON_ACTION_NONE = 0,
    SYSTEM_BUTTON_ACTION_REQUEST_USB_MODE,
    SYSTEM_BUTTON_ACTION_REQUEST_SENSOR_MODE,
    SYSTEM_BUTTON_ACTION_TURN_OFF,
    SYSTEM_BUTTON_ACTION_FACTORY_RESET
} system_button_action_t;

typedef void (*system_button_mode_action_handler_t)(
    system_button_action_t action,
    resq_state_t current_state);

typedef struct {
    system_button_id_t button_id;
    system_button_press_type_t press_type;
    uint32_t duration_ms;
    TickType_t released_tick;
} system_button_event_t;

esp_err_t system_button_manager_init(void);

/** Number of ISR edges recovered after the bounded edge queue was full. */
uint32_t system_button_manager_get_dropped_edge_count(void);

/*
 * New centralized API.
 * Use this in state managers that need state-specific button behavior.
 *
 * Returns ESP_OK if an event was received.
 * Returns ESP_ERR_TIMEOUT if no event was available before timeout.
 */
esp_err_t system_button_manager_wait_event(system_button_event_t *event,
                                           TickType_t timeout_ticks);

/*
 * Non-blocking convenience wrapper.
 */
bool system_button_manager_take_event(system_button_event_t *event);

/** Pure event-to-action mapping used by the centralized dispatcher. */
system_button_action_t system_button_manager_action_for_event(
    const system_button_event_t *event);

/** Register the single global handler for reboot-based mode selection. */
void system_button_manager_set_mode_action_handler(
    system_button_mode_action_handler_t handler);

/*
 * Centralized API for global button actions:
 *   BUTTON_1 short press -> REQUEST_USB_MODE
 *   BUTTON_2 short press -> REQUEST_SENSOR_MODE
 *   BUTTON_1 long press -> TURN_OFF
 *   BUTTON_2 long press -> FACTORY_RESET
 */
system_button_action_t system_button_manager_poll(resq_state_t current_state);

/*
 * Drain/discard pending events/actions in states where they are not allowed.
 */
void system_button_manager_drain_events(resq_state_t current_state);

/*
 * Backward-compatible name if already used.
 */
void system_button_manager_drain_actions(resq_state_t current_state);

const char *system_button_action_to_string(system_button_action_t action);
const char *system_button_id_to_string(system_button_id_t button_id);
const char *system_button_press_type_to_string(system_button_press_type_t press_type);

#ifdef __cplusplus
}
#endif

#endif
