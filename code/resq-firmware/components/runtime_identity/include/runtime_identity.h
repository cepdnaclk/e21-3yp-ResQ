#ifndef RUNTIME_IDENTITY_H
#define RUNTIME_IDENTITY_H

#include <stdbool.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RUNTIME_IDENTITY_BOOT_ID_LEN 16

esp_err_t runtime_identity_init(void);
const char *runtime_identity_boot_id(void);
uint32_t runtime_identity_next_state_seq(void);
uint32_t runtime_identity_current_state_seq(void);
esp_err_t runtime_identity_add_to_json(cJSON *root);
esp_err_t runtime_identity_ensure_json_payload(const char *json_payload,
                                               char **out_payload);
bool runtime_identity_has_valid_ordering(const cJSON *root);

#ifdef __cplusplus
}
#endif

#endif /* RUNTIME_IDENTITY_H */
