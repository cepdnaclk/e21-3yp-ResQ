#include "session_manager.h"

#include <stdio.h>
#include <string.h>

static bool s_active = false;
static char s_session_id[64] = {0};

void session_manager_init(void)
{
    s_active = false;
    s_session_id[0] = '\0';
}

void session_manager_start(const char *session_id)
{
    s_active = true;

    if (session_id != NULL) {
        snprintf(s_session_id, sizeof(s_session_id), "%s", session_id);
    } else {
        s_session_id[0] = '\0';
    }
}

void session_manager_stop(void)
{
    s_active = false;
    s_session_id[0] = '\0';
}

bool session_manager_is_active(void)
{
    return s_active;
}

const char *session_manager_get_id(void)
{
    return s_session_id;
}