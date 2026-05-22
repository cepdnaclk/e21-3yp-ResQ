#include "cpr_metrics.h"

#include <string.h>
#include <stdio.h>
#include <math.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

/* thresholds */
#define COMPRESSION_START_THRESHOLD 0.15f
#define FULL_PRESS_THRESHOLD 0.85f
#define RECOIL_THRESHOLD 0.10f

#define CPR_SENSOR_1_SIDE_LABEL "LEFT"
#define CPR_SENSOR_2_SIDE_LABEL "RIGHT"

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
static int64_t s_last_sample_ms = 0;
static char s_hand_placement[CPR_HAND_PLACEMENT_MAX_LEN] = "NO_CONTACT";
static float s_prev_progress = 0.0f;

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
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);

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
    s_last_sample_ms = 0;
    s_prev_progress = 0.0f;
    strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}

static float clampf(float v, float lo, float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

esp_err_t cpr_metrics_update(const cpr_sensor_sample_t *sample)
{
    if (sample == NULL) return ESP_ERR_INVALID_ARG;
    if (s_mutex == NULL) return ESP_ERR_INVALID_STATE;

    if (xSemaphoreTake(s_mutex, pdMS_TO_TICKS(200)) != pdTRUE) return ESP_ERR_TIMEOUT;

    s_last_sample_ms = sample->ts_ms;

    /* compute hall progress */
    int32_t hall_range = s_calib.hall_full_press - s_calib.hall_baseline;
    float progress = 0.0f;
    if (hall_range != 0) {
        progress = (sample->hall_raw - s_calib.hall_baseline) / (float)hall_range;
    }
    /* clamp between 0 and 1 */
    progress = clampf(progress, 0.0f, 1.0f);
    s_depth_progress = progress;

    /* pressures */
    int32_t p1_delta = sample->pressure_1_raw - s_calib.bladder_1_pressure;
    int32_t p2_delta = sample->pressure_2_raw - s_calib.bladder_2_pressure;

    /* hand placement */
    const int32_t min_contact = 10; /* arbitrary small threshold */
    if (abs(p1_delta) < min_contact && abs(p2_delta) < min_contact) {
        strncpy(s_hand_placement, "NO_CONTACT", sizeof(s_hand_placement) - 1);
    } else {
        if (abs(p1_delta - p2_delta) <= (int)(0.2f * (abs(p1_delta) + abs(p2_delta) + 1))) {
            strncpy(s_hand_placement, "CENTER", sizeof(s_hand_placement) - 1);
        } else if (p1_delta > p2_delta) {
            strncpy(s_hand_placement, CPR_SENSOR_1_SIDE_LABEL, sizeof(s_hand_placement) - 1);
        } else {
            strncpy(s_hand_placement, CPR_SENSOR_2_SIDE_LABEL, sizeof(s_hand_placement) - 1);
        }
    }

    /* compression state machine */
    int64_t now = sample->ts_ms;
    switch (s_state) {
        case WAITING_FOR_COMPRESSION:
            if (progress >= COMPRESSION_START_THRESHOLD) {
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
            if (progress >= FULL_PRESS_THRESHOLD) {
                s_state = FULL_PRESS_REACHED;
                /* evaluate pressure-based validity */
                bool pressure_ok = false;
                int32_t p1_full_delta = s_calib.bladder_1_full_press - s_calib.bladder_1_pressure;
                int32_t p2_full_delta = s_calib.bladder_2_full_press - s_calib.bladder_2_pressure;

                if (p1_full_delta != 0) {
                    float p1_prog = (sample->pressure_1_raw - s_calib.bladder_1_pressure) / (float)p1_full_delta;
                    if (p1_prog >= 0.75f) pressure_ok = true;
                }
                if (p2_full_delta != 0) {
                    float p2_prog = (sample->pressure_2_raw - s_calib.bladder_2_pressure) / (float)p2_full_delta;
                    if (p2_prog >= 0.75f) pressure_ok = true;
                }

                if (pressure_ok) {
                    s_valid_compressions++;
                }
            }
            if (progress < RECOIL_THRESHOLD) {
                /* canceled shallow */
                s_state = WAITING_FOR_COMPRESSION;
            }
            break;

        case FULL_PRESS_REACHED:
            if (progress < FULL_PRESS_THRESHOLD) {
                /* begin releasing phase */
                s_state = RELEASING;
            }
            break;

        case RELEASING:
            /* proper recoil handling */
            if (progress <= RECOIL_THRESHOLD) {
                /* good recoil */
                s_recoil_ok_count++;
                s_last_compression_end_ms = now;
                s_state = WAITING_FOR_COMPRESSION;
            } else if (progress >= COMPRESSION_START_THRESHOLD && progress > s_prev_progress) {
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
    out_snapshot->depth_ok = (s_depth_progress >= FULL_PRESS_THRESHOLD);
    out_snapshot->recoil_ok = (s_recoil_ok_count > 0);
    strncpy(out_snapshot->hand_placement, s_hand_placement, sizeof(out_snapshot->hand_placement) - 1);
    out_snapshot->pressure_balance_pct = 0.0f;
    /* build flags string */
    size_t pos = 0;
    if (out_snapshot->depth_ok) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "DEPTH_OK,");
    }

    /* Only emit rate flags if rate is known (requires at least two compression starts) */
    if (out_snapshot->rate_cpm <= 0.1f) {
        /* rate not known yet: do not add RATE_SLOW/RATE_OK/RATE_FAST */
    } else if (out_snapshot->rate_cpm < 100.0f) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "RATE_SLOW,");
    } else if (out_snapshot->rate_cpm <= 120.0f) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "RATE_OK,");
    } else {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "RATE_FAST,");
    }

    if (out_snapshot->incomplete_recoil_count > 0) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "INCOMPLETE_RECOIL,");
    } else if (out_snapshot->recoil_ok) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "RECOIL_OK,");
    }

    if (strcmp(out_snapshot->hand_placement, "CENTER") == 0) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "HAND_CENTERED");
    } else if (strcmp(out_snapshot->hand_placement, "LEFT") == 0) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "HAND_LEFT");
    } else if (strcmp(out_snapshot->hand_placement, "RIGHT") == 0) {
        pos += snprintf(out_snapshot->flags + pos, sizeof(out_snapshot->flags) - pos, "HAND_RIGHT");
    } else {
        /* NO_CONTACT -> leave empty or no flag */
    }
    out_snapshot->ts_ms = s_last_sample_ms;

    xSemaphoreGive(s_mutex);

    return ESP_OK;
}
