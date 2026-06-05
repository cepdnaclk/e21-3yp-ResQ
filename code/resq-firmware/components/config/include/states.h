#ifndef RESQ_STATES_H
#define RESQ_STATES_H

#ifdef __cplusplus
extern "C" {
#endif

typedef enum
{
    RESQ_STATE_BOOT = 0,
    RESQ_STATE_CONFIG_CHECK,
    RESQ_STATE_PROVISIONING,
    RESQ_STATE_FLUSH_CONFIG,
    RESQ_STATE_WIFI_CONNECTING,
    RESQ_STATE_BACKEND_REGISTERING,
    RESQ_STATE_MQTT_CONNECTING,
    RESQ_STATE_PAIRED_IDLE,
    RESQ_STATE_CALIBRATING,
    RESQ_STATE_CALIBRATION_FAIL,
    RESQ_STATE_READY_FOR_SESSION,
    RESQ_STATE_OTA_UPDATE,
    RESQ_STATE_SESSION_ACTIVE,
    RESQ_STATE_SESSION_INTERRUPTED,
    RESQ_STATE_ERROR,
    RESQ_STATE_RESETTING,
    RESQ_STATE_TURN_OFF

} resq_state_t;

static inline const char *resq_state_to_string(resq_state_t state)
{
    switch (state)
    {
    case RESQ_STATE_BOOT:
        return "BOOT";
    case RESQ_STATE_CONFIG_CHECK:
        return "CONFIG_CHECK";
    case RESQ_STATE_PROVISIONING:
        return "PROVISIONING";
    case RESQ_STATE_FLUSH_CONFIG:
        return "FLUSH_CONFIG";
    case RESQ_STATE_WIFI_CONNECTING:
        return "WIFI_CONNECTING";
    case RESQ_STATE_BACKEND_REGISTERING:
        return "BACKEND_REGISTERING";
    case RESQ_STATE_MQTT_CONNECTING:
        return "MQTT_CONNECTING";
    case RESQ_STATE_PAIRED_IDLE:
        return "PAIRED_IDLE";
    case RESQ_STATE_CALIBRATING:
        return "CALIBRATING";
    case RESQ_STATE_CALIBRATION_FAIL:
        return "CALIBRATION_FAIL";
    case RESQ_STATE_READY_FOR_SESSION:
        return "READY_FOR_SESSION";
    case RESQ_STATE_OTA_UPDATE:
        return "OTA_UPDATE";
    case RESQ_STATE_SESSION_ACTIVE:
        return "SESSION_ACTIVE";
    case RESQ_STATE_SESSION_INTERRUPTED:
        return "SESSION_INTERRUPTED";
    case RESQ_STATE_ERROR:
        return "ERROR";
    case RESQ_STATE_RESETTING:
        return "RESETTING";
    case RESQ_STATE_TURN_OFF:
        return "TURN_OFF";
    default:
        return "UNKNOWN";
    }
}

#ifdef __cplusplus
}
#endif

#endif /* RESQ_STATES_H */
