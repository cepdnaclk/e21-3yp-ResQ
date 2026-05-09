#pragma once

#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
	bool session_active;
	const char *session_id;
	const char *trainee_id;
	const char *started_at;
	const char *scenario;
} session_state_view_t;

void session_manager_init(void);
void session_manager_start(
	const char *session_id,
	const char *trainee_id,
	const char *started_at,
	const char *scenario
);
void session_manager_stop(void);
bool session_manager_is_active(void);
bool session_manager_get_session_id(char *out, size_t out_len);

#ifdef __cplusplus
}
#endif
