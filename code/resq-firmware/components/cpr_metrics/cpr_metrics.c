#include "cpr_metrics.h"

#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static int32_t calib_abs_i32(int32_t v)
{
    return v < 0 ? -v : v;
}

static int32_t calib_max_i32(int32_t a, int32_t b)
{
    return a >= b ? a : b;
}

/* thresholds are adaptive and derived from calibration_config_t at runtime */

#define CPR_SENSOR_1_SIDE_LABEL "LEFT"
#define CPR_SENSOR_2_SIDE_LABEL "RIGHT"
#define CPR_PRESSURE_SATURATION_RAW 8300000
#define CPR_PRESSURE_BALANCE_SENSOR_MASK 0x06u
#define CPR_PRESSURE_BALANCE_HOLD_MAX_MS 300

typedef enum {
    WAITING_FOR_COMPRESSION = 0,
    COMPRESSING,
    FULL_PRESS_REACHED,
    RELEASING
} cpr_state_t;

static calibration_config_t s_calib;
static SemaphoreHandle_t s_mutex = NULL;

/* runtime counters */
static cpr_state_t s_state = WAITING_FOR_COMPRESSION;
static int s_total_compressions = 0;
static int s_valid_compressions = 0;
static int s_recoil_ok_count = 0;
static int s_incomplete_recoil_count = 0;
static float s_rate_cpm = 0.0f;
static int64_t s_last_compression_start_ms = 0;
static int64_t s_current_compression_start_ms = 0;
static int64_t s_last_compression_end_ms = 0;
static float s_depth_progress = 0.0f;
static float s_pressure_balance_pct = 0.0f;
static int64_t s_last_sample_ms = 0;
static char s_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN] = "NO_CONTACT";
static float s_prev_progress = 0.0f;
static char s_last_reliable_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN] = "NO_CONTACT";
static float s_last_reliable_pressure_balance_pct = 0.0f;
static int64_t s_last_reliable_pressure_ms = 0;
static bool s_has_reliable_pressure_balance = false;
static bool s_pressure_balance_reliable = false;
static uint8_t s_pressure_saturation_mask = 0;
static uint32_t s_sensor_quality_flags = 0;
static int s_missed_pressure_samples = 0;
static int s_missed_hall_samples = 0;

esp_err_t cpr_metrics_init(void)
{
    if (s_mutex == NULL) {
        s_mutex = xSemaphoreCreateMutex();
        if (s_mutex == NULL) {
            return ESP_ERR_NO_MEM;
        }
    }

    memset(&s_calib, 0, sizeof(s_calib));
    s_state = WAITING_FOR_COMPRESSION;
    s_total_compressions = 0;
    s_valid_compressions = 0;
    s_recoil_ok_count = 0;
    s_incomplete_recoil_count = 0;
    s_rate_cpm = 0.0f;
    s_last_compression_start_ms = 0;
    s_current_compression_start_ms = 0;
    s_last_compression_end_ms = 0;
    s_depth_progress = 0.0f;
    s_pressure_balance_pct = 0.0f;
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
    strncpy(s_last_reliable_hand_placement, "NO_CONTACT", sizeof(s_last_reliable_hand_placement) - 1);
    s_last_reliable_pressure_balance_pct = 0.0f;
    s_last_reliable_pressure_ms = 0;
    s_has_reliable_pressure_balance = false;
    s_pressure_balance_reliable = false;
    s_pressure_saturation_mask = 0;
    s_sensor_quality_flags = 0;
    s_missed_pressure_samples = 0;
    s_missed_hall_samples = 0;

    return ESP_OK;
}

esp_err_t cpr_metrics_reset(const calibration_config_t *calibration)
{
    if (calibration == NULL) return ESP_ERR_INVALID_ARG;

    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;
    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    memcpy(&s_calib, calibration, sizeof(s_calib));

    s_state = WAITING_FOR_COMPRESSION;
    s_total_compressions = 0;
    s_valid_compressions = 0;
    s_recoil_ok_count = 0;
    s_incomplete_recoil_count = 0;
    s_rate_cpm = 0.0f;
    s_last_compression_start_ms = 0;
    s_current_compression_start_ms = 0;
    s_last_compression_end_ms = 0;
    s_depth_progress = 0.0f;
    s_pressure_balance_pct = 0.0f;
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
    strncpy(s_last_reliable_hand_placement, "NO_CONTACT", sizeof(s_last_reliable_hand_placement) - 1);
    s_last_reliable_pressure_balance_pct = 0.0f;
    s_last_reliable_pressure_ms = 0;
    s_has_reliable_pressure_balance = false;
    s_pressure_balance_reliable = false;
    s_pressure_saturation_mask = 0;
    s_sensor_quality_flags = 0;
    s_missed_pressure_samples = 0;
    s_missed_hall_samples = 0;

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

static float clampf(float v, float lo, float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static bool pressure_is_saturated(int32_t value)
{
    return value > CPR_PRESSURE_SATURATION_RAW || value < -CPR_PRESSURE_SATURATION_RAW;
}

static uint8_t pressure_saturation_mask(const cpr_sensor_sample_t *sample)
{
    uint8_t mask = 0;
    if (pressure_is_saturated(sample->pressure_0_raw)) mask |= 0x01u;
    if (pressure_is_saturated(sample->pressure_1_raw)) mask |= 0x02u;
    if (pressure_is_saturated(sample->pressure_2_raw)) mask |= 0x04u;
    return mask;
}

static void append_snapshot_flag(char *flags, size_t flags_len, size_t *pos, const char *flag)
{
    if (flags == NULL || pos == NULL || flag == NULL || *pos >= flags_len) {
        return;
    }

    int written = snprintf(flags + *pos, flags_len - *pos, "%s", flag);
    if (written <= 0) {
        return;
    }

    if ((size_t)written >= flags_len - *pos) {
        *pos = flags_len - 1;
    } else {
        *pos += (size_t)written;
    }
}

esp_err_t cpr_metrics_update(const cpr_sensor_sample_t *sample)
{
    if (sample == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    s_last_sample_ms = sample->ts_ms;

    bool hall_valid = (sample->quality_flags & CPR_SAMPLE_HALL_READ_FAILED) == 0;
    bool pressure_read_valid = (sample->quality_flags & CPR_SAMPLE_PRESSURE_READ_FAILED) == 0;

    uint32_t current_quality_flags = 0;
    if (!hall_valid) {
        s_missed_hall_samples++;
        current_quality_flags |= CPR_SENSOR_QUALITY_HALL_MISSED;
    }
    if (!pressure_read_valid) {
        s_missed_pressure_samples++;
        current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_MISSED;
    }

    uint8_t current_saturation_mask = pressure_read_valid ? pressure_saturation_mask(sample) : 0;
    if (current_saturation_mask != 0) {
        current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_SATURATED;
    }

    s_pressure_saturation_mask = current_saturation_mask;

    /* compute hall progress using adaptive calibration fields */
    float progress = s_depth_progress;
    int32_t hall_range_raw = s_calib.hall_range_raw;
    int32_t hall_dir = s_calib.hall_direction == 0 ? 1 : s_calib.hall_direction;

    int32_t hall_delta_now = 0;
    if (hall_valid) {
        hall_delta_now = (sample->hall_raw - s_calib.hall_baseline) * hall_dir;
        if (hall_range_raw > 0) {
            progress = (float)hall_delta_now / (float)hall_range_raw;
        } else {
            progress = 0.0f;
        }
        progress = clampf(progress, 0.0f, 1.0f);
        s_depth_progress = progress;
    }

    /* pressures */
    int32_t p1_delta_signed = sample->pressure_1_raw - s_calib.pressure_1_baseline;
    int32_t p2_delta_signed = sample->pressure_2_raw - s_calib.pressure_2_baseline;
    int32_t p1_delta = calib_abs_i32(p1_delta_signed);
    int32_t p2_delta = calib_abs_i32(p2_delta_signed);
    bool pressure_contact = false;
    bool pressure_balanced = false;
    bool pressure_balance_saturated =
        (current_saturation_mask & CPR_PRESSURE_BALANCE_SENSOR_MASK) != 0;
    bool pressure_balance_reliable = pressure_read_valid && !pressure_balance_saturated;
    bool pressure_balance_held_center =
        pressure_read_valid &&
        ((current_saturation_mask & CPR_PRESSURE_BALANCE_SENSOR_MASK) ==
            CPR_PRESSURE_BALANCE_SENSOR_MASK) &&
        s_has_reliable_pressure_balance &&
        s_last_reliable_pressure_ms > 0 &&
        sample->ts_ms - s_last_reliable_pressure_ms <= CPR_PRESSURE_BALANCE_HOLD_MAX_MS &&
        strcmp(s_last_reliable_hand_placement, "CENTER") == 0;

    /*
     * Compare each bladder as a fraction of its own calibrated full-press
     * range. Raw HX710 counts are not directly comparable when the two
     * pressure channels have different gains.
     */
    if (!pressure_balance_reliable) {
        if (s_has_reliable_pressure_balance) {
            strncpy(s_hand_placement,
                    s_last_reliable_hand_placement,
                    sizeof(s_hand_placement) - 1);
            s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
            s_pressure_balance_pct = s_last_reliable_pressure_balance_pct;
            current_quality_flags |= CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD;
        } else {
            strncpy(s_hand_placement, "UNKNOWN", sizeof(s_hand_placement) - 1);
            s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
            s_pressure_balance_pct = 0.0f;
        }
    } else if (calib_max_i32(p1_delta, p2_delta) < s_calib.pressure_contact_threshold) {
        strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
        s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
        s_pressure_balance_pct = 0.0f;
    } else {
        pressure_contact = true;
        int64_t p1_normalized = s_calib.pressure_1_range_raw > 0
                                    ? ((int64_t)p1_delta * 1000) /
                                          s_calib.pressure_1_range_raw
                                    : p1_delta;
        int64_t p2_normalized = s_calib.pressure_2_range_raw > 0
                                    ? ((int64_t)p2_delta * 1000) /
                                          s_calib.pressure_2_range_raw
                                    : p2_delta;
        int64_t normalized_total = p1_normalized + p2_normalized;
        int32_t imbalance_pct = normalized_total > 0
                                    ? (int32_t)(llabs(p1_normalized - p2_normalized) *
                                                100 / normalized_total)
                                    : 100;

        pressure_balanced =
            imbalance_pct <= s_calib.pressure_balance_allowed_pct;
        s_pressure_balance_pct = (float)(100 - imbalance_pct);

        if (pressure_balanced) {
            strncpy(s_hand_placement, "CENTER", sizeof(s_hand_placement) - 1);
        } else if (p1_normalized > p2_normalized) {
            strncpy(s_hand_placement, CPR_SENSOR_1_SIDE_LABEL, sizeof(s_hand_placement) - 1);
        } else {
            strncpy(s_hand_placement, CPR_SENSOR_2_SIDE_LABEL, sizeof(s_hand_placement) - 1);
        }
        s_hand_placement[sizeof(s_hand_placement) - 1] = '\0';
        strncpy(s_last_reliable_hand_placement,
                s_hand_placement,
                sizeof(s_last_reliable_hand_placement) - 1);
        s_last_reliable_hand_placement[sizeof(s_last_reliable_hand_placement) - 1] = '\0';
        s_last_reliable_pressure_balance_pct = s_pressure_balance_pct;
        s_last_reliable_pressure_ms = sample->ts_ms;
        s_has_reliable_pressure_balance = true;
    }
    s_pressure_balance_reliable = pressure_balance_reliable;
    s_sensor_quality_flags = current_quality_flags;

    /* compression state machine. Without a Hall sample, keep the previous
     * depth/state and wait for a valid depth observation before advancing. */
    int64_t now = sample->ts_ms;
    if (hall_valid) {
        switch (s_state) {
            case WAITING_FOR_COMPRESSION:
                /* compression start when adaptive hall start delta reached */
                if (hall_delta_now >= s_calib.hall_start_delta) {
                    /* new compression started */
                    s_state = COMPRESSING;
                    /* start new compression and update rate based on start-to-start interval */
                    int64_t prev_start = s_last_compression_start_ms;
                    s_current_compression_start_ms = now;
                    if (prev_start > 0) {
                        int64_t interval_ms = s_current_compression_start_ms - prev_start;
                        if (interval_ms >= 250 && interval_ms <= 3000) {
                            float instant_rate = 60000.0f / (float)interval_ms;
                            if (s_rate_cpm <= 0.1f) {
                                s_rate_cpm = instant_rate;
                            } else {
                                s_rate_cpm = (0.7f * s_rate_cpm) + (0.3f * instant_rate);
                            }
                        }
                    }
                    s_last_compression_start_ms = s_current_compression_start_ms;
                    s_total_compressions++;
                }
                break;

            case COMPRESSING:
                /* use adaptive full-press threshold */
                if (hall_delta_now >= s_calib.hall_full_delta_threshold) {
                    s_state = FULL_PRESS_REACHED;
                    /* evaluate pressure-based validity */
                    bool pressure_ok = false;
                    /* pressure validity using absolute adaptive threshold */
                    if ((pressure_balance_reliable &&
                         pressure_contact &&
                         pressure_balanced &&
                         calib_max_i32(p1_delta, p2_delta) >=
                             s_calib.pressure_valid_threshold) ||
                        pressure_balance_held_center) {
                        pressure_ok = true;
                    }

                    if (pressure_ok) {
                        s_valid_compressions++;
                    }
                }
                if (hall_delta_now <= s_calib.hall_recoil_delta) {
                    /* canceled shallow or recoil detected too early */
                    s_state = WAITING_FOR_COMPRESSION;
                }
                break;

            case FULL_PRESS_REACHED:
                if (hall_delta_now < s_calib.hall_full_delta_threshold) {
                    /* begin releasing phase */
                    s_state = RELEASING;
                }
                break;

            case RELEASING:
                /* proper recoil handling */
                if (hall_delta_now <= s_calib.hall_recoil_delta) {
                    /* good recoil */
                    s_recoil_ok_count++;
                    s_last_compression_end_ms = now;
                    s_state = WAITING_FOR_COMPRESSION;
                } else if (s_calib.hall_range_raw > 0 && progress >= ((float)s_calib.hall_start_delta / (float)s_calib.hall_range_raw) && progress > s_prev_progress) {
                    /* new compression before full recoil */
                    s_incomplete_recoil_count++;
                    /* start new compression (counted as a new compression start) */
                    int64_t prev_start = s_last_compression_start_ms;
                    s_current_compression_start_ms = now;
                    if (prev_start > 0) {
                        int64_t interval_ms = s_current_compression_start_ms - prev_start;
                        if (interval_ms >= 250 && interval_ms <= 3000) {
                            float instant_rate = 60000.0f / (float)interval_ms;
                            if (s_rate_cpm <= 0.1f) {
                                s_rate_cpm = instant_rate;
                            } else {
                                s_rate_cpm = (0.7f * s_rate_cpm) + (0.3f * instant_rate);
                            }
                        }
                    }
                    s_last_compression_start_ms = s_current_compression_start_ms;
                    s_total_compressions++;
                    s_state = COMPRESSING;
                }
                break;
        }

        /* update previous sample progress for next iteration */
        s_prev_progress = progress;
    }

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

esp_err_t cpr_metrics_get_snapshot(cpr_metrics_snapshot_t *out_snapshot)
{
    if (out_snapshot == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    out_snapshot->depth_progress = s_depth_progress;
    out_snapshot->rate_cpm = s_rate_cpm;
    out_snapshot->pause_s = 0.0f;
    if (s_last_compression_start_ms != 0) {
        out_snapshot->pause_s = (s_last_sample_ms - s_last_compression_start_ms) / 1000.0f;
    }
    out_snapshot->total_compressions = s_total_compressions;
    out_snapshot->valid_compressions = s_valid_compressions;
    out_snapshot->recoil_ok_count = s_recoil_ok_count;
    out_snapshot->incomplete_recoil_count = s_incomplete_recoil_count;
    /* depth_ok determined by adaptive hall full-press threshold */
    out_snapshot->depth_ok = false;
    if (s_calib.hall_range_raw > 0 && s_calib.hall_full_delta_threshold > 0) {
        float full_pct = (float)s_calib.hall_full_delta_threshold / (float)s_calib.hall_range_raw;
        out_snapshot->depth_ok = (s_depth_progress >= full_pct);
    }
    out_snapshot->recoil_ok = (s_recoil_ok_count > 0);
    strncpy(out_snapshot->hand_placement, s_hand_placement, sizeof(out_snapshot->hand_placement) - 1);
    out_snapshot->hand_placement[sizeof(out_snapshot->hand_placement) - 1] = '\0';
    out_snapshot->pressure_balance_pct = s_pressure_balance_pct;
    out_snapshot->pressure_balance_reliable = s_pressure_balance_reliable;
    out_snapshot->pressure_saturation_mask = s_pressure_saturation_mask;
    out_snapshot->sensor_quality_flags = s_sensor_quality_flags;
    out_snapshot->missed_pressure_samples = s_missed_pressure_samples;
    out_snapshot->missed_hall_samples = s_missed_hall_samples;
    /* build flags string */
    out_snapshot->flags[0] = '\0';
    size_t pos = 0;
    if (out_snapshot->depth_ok) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "DEPTH_OK,");
    }

    /* Only emit rate flags if rate is known (requires at least two compression starts) */
    if (out_snapshot->rate_cpm <= 0.1f) {
        /* rate not known yet: do not add RATE_SLOW/RATE_OK/RATE_FAST */
    } else if (out_snapshot->rate_cpm < 100.0f) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_SLOW,");
    } else if (out_snapshot->rate_cpm <= 120.0f) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_OK,");
    } else {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RATE_FAST,");
    }

    if (out_snapshot->incomplete_recoil_count > 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "INCOMPLETE_RECOIL,");
    } else if (out_snapshot->recoil_ok) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "RECOIL_OK,");
    }

    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_MISSED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_MISSED,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_HALL_MISSED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HALL_MISSED,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_SATURATED) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_SATURATED,");
    }
    if (out_snapshot->sensor_quality_flags & CPR_SENSOR_QUALITY_PRESSURE_BALANCE_HELD) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "PRESSURE_BALANCE_HELD,");
    }

    if (strcmp(out_snapshot->hand_placement, "CENTER") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_CENTERED");
    } else if (strcmp(out_snapshot->hand_placement, "LEFT") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_LEFT");
    } else if (strcmp(out_snapshot->hand_placement, "RIGHT") == 0) {
        append_snapshot_flag(out_snapshot->flags, sizeof(out_snapshot->flags), &pos, "HAND_RIGHT");
    } else {
        /* NO_CONTACT -> leave empty or no flag */
    }
    out_snapshot->flags[sizeof(out_snapshot->flags) - 1] = '\0';
    out_snapshot->ts_ms = s_last_sample_ms;

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}
