#pragma once

#include <stdbool.h>


// Expose C-compatible symbols when included from C++ code.
#ifdef __cplusplus
extern "C" {
#endif

// Possible feedback results for CPR compression depth.
typedef enum {
  CPR_FEEDBACK_NONE = 0,     // No valid CPR feedback yet.
  CPR_FEEDBACK_TOO_SHALLOW,  // Compression depth is below the target range.
  CPR_FEEDBACK_TOO_DEEP,     // Compression depth exceeds the target range.
  CPR_FEEDBACK_PERFECT       // Compression depth is within the target range.
} cpr_feedback_t;

// Threshold values used to evaluate CPR compression depth.
// hall_min_delta: minimum expected sensor change during compression.
// hall_max_delta: maximum expected sensor change during compression.
// compression_start_delta: sensor change that indicates compression has started.
typedef struct {
  int hall_min_delta;
  int hall_max_delta;
  int compression_start_delta;
} cpr_thresholds_t;

// Runtime state used by CPR logic.
// is_compressing: whether a compression is currently in progress.
// peak_delta: highest sensor delta observed during the current compression.
// total_compressions: total number of compressions detected so far.
typedef struct {
  bool is_compressing;
  int peak_delta;
  int last_peak_delta;
  int total_compressions;
} cpr_state_t;

// Initialize CPR state before use.
void cpr_logic_init(cpr_state_t *state);

// Update CPR logic with the latest sensor delta and thresholds.
// Returns feedback describing the current compression depth.
cpr_feedback_t cpr_logic_update(
    cpr_state_t *state,
    const cpr_thresholds_t *thresholds,
    int current_delta
);

// Convert a CPR feedback value to a human-readable string.
const char *cpr_feedback_to_string(cpr_feedback_t feedback);

#ifdef __cplusplus
}
#endif
