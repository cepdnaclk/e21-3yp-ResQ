#ifndef SESSION_MANAGER_H
#define SESSION_MANAGER_H

#include <stdbool.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RESQ_SESSION_ID_MAX_LEN 64
#define RESQ_PROFILE_ID_MAX_LEN 64

typedef struct {
    bool active;
    char session_id[RESQ_SESSION_ID_MAX_LEN];
    char profile_id[RESQ_PROFILE_ID_MAX_LEN];
    int64_t started_at_ms;
    int64_t stopped_at_ms;
    bool interrupted;
} session_state_t;

esp_err_t session_manager_init(void);

esp_err_t session_manager_start(const char *session_id,
                                const char *profile_id);

esp_err_t session_manager_stop(const char *session_id);

esp_err_t session_manager_mark_interrupted(const char *reason);

bool session_manager_is_active(void);

esp_err_t session_manager_get_state(session_state_t *out_state);

const char *session_manager_get_session_id(void);

#ifdef __cplusplus
}
#endif

#endif
