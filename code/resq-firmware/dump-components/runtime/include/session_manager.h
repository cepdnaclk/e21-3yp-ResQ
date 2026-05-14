#pragma once

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

void session_manager_init(void);
void session_manager_start(const char *session_id);
void session_manager_stop(void);
bool session_manager_is_active(void);
bool session_manager_get_session_id(char *out, size_t out_len);

#ifdef __cplusplus
}
#endif
