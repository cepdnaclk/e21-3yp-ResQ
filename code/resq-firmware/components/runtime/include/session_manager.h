#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

void session_manager_init(void);
void session_manager_start(const char *session_id);
void session_manager_stop(void);
bool session_manager_is_active(void);
const char *session_manager_get_id(void);

#ifdef __cplusplus
}
#endif