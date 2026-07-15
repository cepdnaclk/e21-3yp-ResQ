#ifndef SESSION_COMMAND_TYPES_H
#define SESSION_COMMAND_TYPES_H

#include <stdint.h>

typedef struct {
    char command_id[128];      // 128 bytes including terminator
    char session_id[128];      // 128 bytes including terminator
    char profile_id[32];       // 32 bytes including terminator
    uint32_t profile_version;
    char profile_hash[65];     // 65 bytes including terminator
} session_start_command_t;

#endif // SESSION_COMMAND_TYPES_H
