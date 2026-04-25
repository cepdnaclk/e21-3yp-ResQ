#include "session_manager.h"

#include <stdio.h>
#include <string.h>

typedef struct {
    bool session_active;
    char session_id[64];
    char trainee_id[64];
    char started_at[64];
    char scenario[64];
} session_state_t;

static session_state_t s_state = {0};

static void copy_text(char *dst, size_t dst_len, const char *src)
{
    if (dst == NULL || dst_len == 0) {
        return;
    }

    if (src != NULL && src[0] != '\0') {
        snprintf(dst, dst_len, "%s", src);
    } else {
        dst[0] = '\0';
    }
}

void session_manager_init(void)
{
    memset(&s_state, 0, sizeof(s_state));
}

void session_manager_start(
    const char *session_id,
    const char *trainee_id,
    const char *started_at,
    const char *scenario
)
{
    s_state.session_active = true;
    copy_text(s_state.session_id, sizeof(s_state.session_id), session_id);
    copy_text(s_state.trainee_id, sizeof(s_state.trainee_id), trainee_id);
    copy_text(s_state.started_at, sizeof(s_state.started_at), started_at);
    copy_text(s_state.scenario, sizeof(s_state.scenario), scenario);
}

void session_manager_stop(void)
{
    memset(&s_state, 0, sizeof(s_state));
}

bool session_manager_is_active(void)
{
    return s_state.session_active;
}

const char *session_manager_get_id(void)
{
    return s_state.session_id;
}

const char *session_manager_get_trainee_id(void)
{
    return s_state.trainee_id;
}

const char *session_manager_get_started_at(void)
{
    return s_state.started_at;
}

const char *session_manager_get_scenario(void)
{
    return s_state.scenario;
}

session_state_view_t session_manager_get_state(void)
{
    session_state_view_t view = {
        .session_active = s_state.session_active,
        .session_id = s_state.session_id,
        .trainee_id = s_state.trainee_id,
        .started_at = s_state.started_at,
        .scenario = s_state.scenario,
    };

    return view;
}