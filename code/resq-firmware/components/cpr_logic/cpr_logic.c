#include "cpr_logic.h"

void cpr_logic_init(cpr_state_t *state)
{
  state->is_compressing = false;   // No compression is currently in progress
  state->peak_delta = 0;            // No compression depth recorded yet
  state->last_peak_delta = 0;       // Last completed compression peak
  state->total_compressions = 0;    // Start with zero completed compressions
}

/*
 * Update CPR state using the latest depth reading.
 *
 * current_delta: current compression depth measurement
 * thresholds:
 *   - compression_start_delta: depth needed to consider a compression started
 *   - hall_min_delta / hall_max_delta: acceptable depth range for a good compression
 *
 * Returns feedback only when a compression ends.
 */
cpr_feedback_t cpr_logic_update(
    cpr_state_t *state,
    const cpr_thresholds_t *thresholds,
    int current_delta
)
{
  // If depth exceeds the start threshold, a compression is in progress.
  if (current_delta > thresholds->compression_start_delta) {
    state->is_compressing = true;

    // Track the deepest point reached during this compression.
    if (current_delta > state->peak_delta) {
      state->peak_delta = current_delta;
    }

    // No feedback yet until the compression ends.
    return CPR_FEEDBACK_NONE;
  }

  // If we were compressing and the depth falls back below the start threshold,
  // the compression has ended.
  if (state->is_compressing && current_delta < thresholds->compression_start_delta) {
    state->total_compressions++;
    state->last_peak_delta = state->peak_delta;

    cpr_feedback_t feedback = CPR_FEEDBACK_NONE;

    // Classify the completed compression based on peak depth.
    if (state->peak_delta < thresholds->hall_min_delta) {
      feedback = CPR_FEEDBACK_TOO_SHALLOW;
    } else if (state->peak_delta > thresholds->hall_max_delta) {
      feedback = CPR_FEEDBACK_TOO_DEEP;
    } else {
      feedback = CPR_FEEDBACK_PERFECT;
    }

    // Reset tracking for the next compression.
    state->is_compressing = false;
    state->peak_delta = 0;

    return feedback;
  }

  // No state change and no feedback needed.
  return CPR_FEEDBACK_NONE;
}

/*
 * Convert CPR feedback enum to a human-readable string.
 */
const char *cpr_feedback_to_string(cpr_feedback_t feedback)
{
  switch (feedback) {
    case CPR_FEEDBACK_TOO_SHALLOW:
      return "TOO SHALLOW";
    case CPR_FEEDBACK_TOO_DEEP:
      return "TOO DEEP";
    case CPR_FEEDBACK_PERFECT:
      return "PERFECT DEPTH";
    case CPR_FEEDBACK_NONE:
    default:
      return "NONE";
  }
}
