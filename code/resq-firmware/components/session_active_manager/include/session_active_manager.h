#ifndef SESSION_ACTIVE_MANAGER_H
#define SESSION_ACTIVE_MANAGER_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "states.h"
#include "resq_config_types.h"
#include "mqtt_manager.h"

#ifdef __cplusplus
extern "C" {
#endif

#define SESSION_PRESSURE_CHANNEL_COUNT 3u
#define SESSION_PRESSURE_SNAPSHOT_MAX_AGE_MS 200

typedef struct {
    int32_t raw[SESSION_PRESSURE_CHANNEL_COUNT];
    uint8_t valid_mask;
    uint8_t saturation_mask;
    esp_err_t read_error;
    int64_t timestamp_ms;
    uint32_t sequence;
    bool available;
    bool temporarily_degraded;
} session_pressure_snapshot_t;

esp_err_t session_active_manager_init(void);

/**
 * Store one completed pressure acquisition. The function assigns a new
 * sequence number and never holds the snapshot mutex during sensor I/O.
 */
esp_err_t session_pressure_snapshot_store(
    const session_pressure_snapshot_t *snapshot);

/**
 * Copy the latest pressure-task snapshot without performing sensor I/O.
 * The snapshot mutex is held only for the structure copy.
 */
esp_err_t session_pressure_snapshot_get(
    session_pressure_snapshot_t *out_snapshot);

/**
 * Return true only for a new, non-future snapshot within max_age_ms.
 */
bool session_pressure_snapshot_is_fresh(
    const session_pressure_snapshot_t *snapshot,
    uint32_t last_consumed_sequence,
    int64_t now_ms,
    int64_t max_age_ms);

resq_state_t session_active_manager_start(network_config_t *network_config,
                                          calibration_config_t *calibration_config,
                                          const char *ip_address,
                                          const char *session_id,
                                          const char *profile_id,
                                          const resq_mqtt_command_t *cmd);

resq_state_t session_active_manager_run(network_config_t *network_config,
                                        calibration_config_t *calibration_config,
                                        const char *ip_address);

bool session_active_manager_is_sensor_running(void);

/** Stop session acquisition, CPR telemetry, and buzzer; safe when idle. */
esp_err_t session_active_manager_stop_sensor_acquisition(void);

bool session_active_manager_has_pending_interruption(void);

esp_err_t session_active_manager_publish_pending_interruption(
    network_config_t *network_config,
    calibration_config_t *calibration_config,
    const char *ip_address);

#ifdef __cplusplus
}
#endif

#endif
