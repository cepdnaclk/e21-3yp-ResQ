#include "calibration_manager.h"

#include <ctype.h>
#include <float.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

#include "board_config.h"
#include "cJSON.h"
#include "calibration_codes.h"
#include "config_store.h"
#include "mbedtls/sha256.h"

static esp_err_t calculate_fingerprint(
    const char *profile_id, uint32_t profile_version,
    int32_t hall_delta, int32_t ref_pressure,
    int32_t bladder_1_pressure, int32_t bladder_2_pressure,
    char *out_hex, size_t out_hex_len
);

#include "hall_sensor.h"
#include "hx710.h"
#include "mqtt_manager.h"
#include "mqtt_topics.h"
#include "runtime_helpers.h"
#include "sensor_conversion.h"
#include "sensor_owner.h"
#include "states.h"
#include "status_indicator.h"

/* Calibration manager configuration */
#define CALIBRATION_TASK_STACK_SIZE 6144
#define CALIBRATION_TASK_PRIORITY 5

#define CALIBRATION_POLL_DELAY_MS 50
#define CALIBRATION_MAX_WAIT_MS 30000

/* Stable sampling configuration. */
#define CALIBRATION_REST_OBSERVATIONS 60
#define CALIBRATION_MAX_INVALID_PERCENT 20
#define CALIBRATION_MAX_STATS_SAMPLES 64
#define CALIBRATION_NOISE_TRIM_PERCENT 10
#define CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT 20
#define CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT 20
#define CALIBRATION_FULL_PRESS_HOLD_SAMPLES 5
#define CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES 20
#define CALIBRATION_CAPTURE_SAMPLE_DELAY_MS 20
#define CALIBRATION_CANCEL_WAIT_MS 5000
#define CALIBRATION_OPTIONAL_PRESSURE_MAX_READ_FAILURES 3
#define CALIBRATION_FULL_PRESS_FINAL_MIN_PCT 85
#define CALIBRATION_FULL_PRESS_FINAL_MAX_PCT 115

/* Noise margins used to keep runtime thresholds above normal sensor jitter. */
#define CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER 4
#define CALIBRATION_PRESSURE_CONTACT_NOISE_MULTIPLIER 4
#define CALIBRATION_PRESSURE_MIN_SNR_MULTIPLIER 5

/* Stuck-zero detection: consider values very close to zero as suspicious */
#define CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW 8
#define CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT 3

/* Private variables */
static const char *TAG = "calibration_manager";

static TaskHandle_t s_calibration_task_handle = NULL;
static EventGroupHandle_t s_calibration_events = NULL;
#define CAL_EVENT_TASK_RUNNING BIT0
#define CAL_EVENT_TASK_DONE BIT1
#define CAL_EVENT_CANCEL_REQ BIT2

static calibration_config_t s_candidate_config;
static calibration_config_t s_calibration_config;
static SemaphoreHandle_t s_manager_mutex = NULL;

#define LOCK_MGR()   do { if (s_manager_mutex) xSemaphoreTake(s_manager_mutex, portMAX_DELAY); } while(0)
#define UNLOCK_MGR() do { if (s_manager_mutex) xSemaphoreGive(s_manager_mutex); } while(0)

static struct {
    char profile_id[32];
    uint32_t profile_version;
    char profile_hash[65];
    bool reserved;
} s_session_reservation = {0};

static hall_sensor_t s_hall_sensor;

static network_config_t s_network_config;

/* Track consecutive near-zero readings per HX710 sensor (indices 0..2) */
static int s_hx710_zero_streaks[3] = {0, 0, 0};

/* Last raw triplet from the shared HX710 read (for logging) */
static int32_t s_last_hx710_raw[3] = {0, 0, 0};

/* current command id for the running calibration */
static char s_command_id[64] = {0};

/* request_id provided by LocalHub for replies (reply_id) */
static char s_request_id[128] = {0};

/* Store the request_id for the running calibration. Used as reply_id in events.
 */
void calibration_manager_set_request_id(const char *request_id) {
  if (request_id == NULL) {
    s_request_id[0] = '\0';
    return;
  }

  strncpy(s_request_id, request_id, sizeof(s_request_id) - 1);
  s_request_id[sizeof(s_request_id) - 1] = '\0';
}

const char *calibration_manager_get_request_id(void) { return s_request_id; }

static bool s_initialized = false;
static bool s_running = false;
static calibration_reason_id_t s_last_failure_reason = CAL_REASON_NONE;
static calibration_action_id_t s_last_failure_action = CAL_ACTION_NONE;
static calibration_config_t s_last_host_params;
static bool s_has_last_host_params = false;

/* Forward declaration for failure helper used by earlier functions */
static void calibration_manager_fail(calibration_reason_id_t reason_id);

/* =========================================================
 * Small internal
 * helper functions
 * =========================================================
 */

static bool json_number_to_i32(const cJSON *item, int32_t minimum,
                               int32_t maximum, int32_t *out_value) {
  if (!cJSON_IsNumber(item) || out_value == NULL ||
      !isfinite(item->valuedouble) ||
      trunc(item->valuedouble) != item->valuedouble ||
      item->valuedouble < (double)minimum ||
      item->valuedouble > (double)maximum) {
    return false;
  }
  *out_value = (int32_t)item->valuedouble;
  return true;
}

static bool json_number_to_positive_float(const cJSON *item, float maximum,
                                          float *out_value) {
  if (!cJSON_IsNumber(item) || out_value == NULL ||
      !isfinite(item->valuedouble) || item->valuedouble <= 0.0 ||
      item->valuedouble > (double)maximum) {
    return false;
  }
  *out_value = (float)item->valuedouble;
  return isfinite(*out_value);
}

static bool json_identifier_valid(const cJSON *item, size_t capacity) {
  if (!cJSON_IsString(item) || item->valuestring == NULL) {
    return false;
  }
  size_t len = strnlen(item->valuestring, capacity);
  if (len == 0 || len >= capacity) {
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    unsigned char c = (unsigned char)item->valuestring[i];
    if (!isalnum(c) && c != '-' && c != '_' && c != ':' && c != '.') {
      return false;
    }
  }
  return true;
}

static bool calibration_cancel_requested(void) {
  if (!s_running) {
    return true;
  }

  if (s_calibration_events != NULL) {
    EventBits_t bits = xEventGroupGetBits(s_calibration_events);
    if ((bits & CAL_EVENT_CANCEL_REQ) != 0) {
      return true;
    }
  }

  return false;
}

static esp_err_t calibration_delay_or_cancel(int delay_ms) {
  if (delay_ms <= 0) {
    return calibration_cancel_requested() ? ESP_ERR_INVALID_STATE : ESP_OK;
  }

  if (calibration_cancel_requested()) {
    return ESP_ERR_INVALID_STATE;
  }

  (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(delay_ms));

  return calibration_cancel_requested() ? ESP_ERR_INVALID_STATE : ESP_OK;
}

static const char *
calibration_reason_contract_id(calibration_reason_id_t reason_id) {
  switch (reason_id) {
  case CAL_REASON_NONE:
    return "00000";
  case CAL_REASON_INVALID_CALIBRATION_PAYLOAD:
    return "08101";
  case CAL_REASON_CALIBRATION_ALREADY_RUNNING:
    return "08102";
  case CAL_REASON_INVALID_HALL_DELTA:
    return "08103";
  case CAL_REASON_REF_PRESSURE_TIMEOUT:
    return "08401";
  case CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT:
    return "08402";
  case CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT:
    return "08403";
  case CAL_REASON_HALL_BASELINE_READ_FAILED:
    return "08404";
  case CAL_REASON_HALL_FULL_PRESS_TIMEOUT:
    return "08405";
  case CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED:
    return "08406";
  case CAL_REASON_PRESSURE_IMBALANCE_TOO_HIGH:
    return "08407";
  case CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE:
    return "08408";
  case CAL_REASON_SENSOR_STUCK_OR_NOISE:
    return "08409";
  case CAL_REASON_HALL_RANGE_TOO_SMALL:
    return "08410";
  case CAL_REASON_HALL_NOISE_TOO_HIGH:
    return "08418";
  case CAL_REASON_PRESSURE_RANGE_TOO_SMALL:
    return "08412";
  case CAL_REASON_PRESSURE_NOISE_TOO_HIGH:
    return "08413";
  case CAL_REASON_ADAPTIVE_THRESHOLD_INVALID:
    return "08414";
  case CAL_REASON_PRESSURE_SENSOR_SATURATED:
    return "08415";
  case CAL_REASON_PRESSURE_SENSOR_FLOATING_OR_DISCONNECTED:
    return "08416";
  case CAL_REASON_PRESSURE_BASELINE_UNSTABLE:
    return "08417";
  case CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE:
    return "08411";
  case CAL_REASON_NVS_SAVE_FAILED:
    return "08301";
  case CAL_REASON_CORRUPT:
    return "08302";
  case CAL_REASON_UNSUPPORTED_SCHEMA:
    return "08303";
  case CAL_REASON_IO_ERROR:
    return "08304";
  case CAL_REASON_COMMIT_VERIFICATION_FAILED:
    return "08305";
  case CAL_REASON_GENERATION_EXHAUSTED:
    return "08306";
  case CAL_REASON_PROFILE_HASH_MISMATCH:
    return "08307";
  case CAL_REASON_MQTT_DISCONNECTED_DURING_CALIBRATION:
    return "08501";
  case CAL_REASON_WIFI_DISCONNECTED_DURING_CALIBRATION:
    return "08502";
  case CAL_REASON_CALIBRATION_CANCELLED:
    return "08701";
  default:
    return "08999";
  }
}

static int calibration_result_progress_id(const char *result) {
  if (result == NULL) {
    return 0;
  }

  if (strcmp(result, "STARTED") == 0) {
    return 1;
  }
  if (strcmp(result, "PASS") == 0 ||
      strcmp(result, "PASS_WITH_WARNINGS") == 0) {
    return 11;
  }
  if (strcmp(result, "FAIL") == 0) {
    return 12;
  }
  if (strcmp(result, "CANCELLED") == 0 || strcmp(result, "CANCELED") == 0) {
    return 13;
  }

  return 0;
}

static const char *
calibration_pressure_mode_to_string(calibration_pressure_mode_t mode) {
  switch (mode) {
  case CALIBRATION_PRESSURE_REQUIRED:
    return "REQUIRED";
  case CALIBRATION_PRESSURE_OPTIONAL:
    return "OPTIONAL";
  case CALIBRATION_HALL_ONLY:
    return "HALL_ONLY";
  case CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE:
    return "HALL_WITH_LAST_STABLE_PRESSURE";
  default:
    return "OPTIONAL";
  }
}

typedef struct {
  bool has_stable_pressure;
  bool p0_stable;
  bool p1_stable;
  bool p2_stable;
  int32_t last_stable_p0;
  int32_t last_stable_p1;
  int32_t last_stable_p2;
  int64_t last_stable_ts_ms;
  bool saturated_now;
  bool pressure_degraded;
} calibration_pressure_snapshot_t;

static calibration_pressure_snapshot_t s_pressure_snapshot;
static sensor_raw_sample_t s_last_calibration_raw_sample;
static bool s_has_last_calibration_raw_sample = false;
static bool s_last_calibration_pressure_valid = false;
static bool s_last_calibration_hall_valid = false;

static bool calibration_pressure_is_optional(void) {
  return s_candidate_config.pressure_mode != CALIBRATION_PRESSURE_REQUIRED;
}

static bool
calibration_pressure_targets_required(calibration_pressure_mode_t mode) {
  return mode == CALIBRATION_PRESSURE_REQUIRED;
}

static bool
calibration_pressure_targets_usable(const calibration_config_t *config) {
  return config != NULL && config->ref_pressure > 0 &&
         config->bladder_1_pressure > 0 && config->bladder_2_pressure > 0;
}

static bool
calibration_pressure_mode_parse(const cJSON *item,
                                calibration_pressure_mode_t *out_mode) {
  if (out_mode == NULL) {
    return false;
  }

  if (item == NULL) {
    *out_mode = CALIBRATION_PRESSURE_OPTIONAL;
    return true;
  }

  if (cJSON_IsString(item) && item->valuestring != NULL) {
    if (strcmp(item->valuestring, "REQUIRED") == 0) {
      *out_mode = CALIBRATION_PRESSURE_REQUIRED;
      return true;
    }
    if (strcmp(item->valuestring, "OPTIONAL") == 0) {
      *out_mode = CALIBRATION_PRESSURE_OPTIONAL;
      return true;
    }
    if (strcmp(item->valuestring, "HALL_ONLY") == 0) {
      *out_mode = CALIBRATION_HALL_ONLY;
      return true;
    }
    return false;
  }

  if (cJSON_IsNumber(item)) {
    int value = item->valueint;
    if (value >= CALIBRATION_PRESSURE_REQUIRED &&
        value <= CALIBRATION_HALL_ONLY) {
      *out_mode = (calibration_pressure_mode_t)value;
      return true;
    }
  }

  return false;
}

static esp_err_t calibration_convert_host_hall_delta(int32_t host_value,
                                                     int32_t sample_count,
                                                     bool value_is_sum,
                                                     int32_t *out_adc_counts) {
  if (out_adc_counts == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!value_is_sum) {
    if (host_value < CALIBRATION_HALL_DELTA_MIN_RAW ||
        host_value > CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS) {
      return ESP_ERR_INVALID_ARG;
    }

    *out_adc_counts = host_value;
    return ESP_OK;
  }

  if (sample_count <= 0 || sample_count > CALIBRATION_MAX_STATS_SAMPLES ||
      host_value <= 0) {
    return ESP_ERR_INVALID_ARG;
  }

  int64_t max_sum =
      (int64_t)CALIBRATION_HALL_ADC_MAX_RAW * (int64_t)sample_count;
  if ((int64_t)host_value > max_sum) {
    return ESP_ERR_INVALID_ARG;
  }

  /*
   * Firmware stores hall_delta in averaged ADC counts. If LocalHub sends
   * an
   * accumulated sum, the payload must also say how many samples
   * produced it.
   */
  int32_t converted = (host_value + (sample_count / 2)) / sample_count;
  if (converted < CALIBRATION_HALL_DELTA_MIN_RAW ||
      converted > CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS) {
    return ESP_ERR_INVALID_ARG;
  }

  *out_adc_counts = converted;
  return ESP_OK;
}

static void calibration_mark_pressure_degraded(bool using_last_stable) {
  s_pressure_snapshot.pressure_degraded = true;
  s_pressure_snapshot.saturated_now = true;
  s_candidate_config.pressure_degraded = true;
  s_candidate_config.pressure_valid = false;
  s_candidate_config.hall_valid = true;
  s_candidate_config.using_last_stable_pressure =
      using_last_stable && s_pressure_snapshot.has_stable_pressure;
  s_candidate_config.pressure_mode =
      s_candidate_config.using_last_stable_pressure
          ? CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE
          : CALIBRATION_HALL_ONLY;
}

static void calibration_update_stable_pressure(bool p0_stable, bool p1_stable,
                                               bool p2_stable, int32_t p0,
                                               int32_t p1, int32_t p2) {
  if (p0_stable) {
    s_pressure_snapshot.p0_stable = true;
    s_pressure_snapshot.last_stable_p0 = p0;
  }
  if (p1_stable) {
    s_pressure_snapshot.p1_stable = true;
    s_pressure_snapshot.last_stable_p1 = p1;
  }
  if (p2_stable) {
    s_pressure_snapshot.p2_stable = true;
    s_pressure_snapshot.last_stable_p2 = p2;
  }

  /* A fallback pressure profile is usable only when every channel has its own
   * measured stable value. One healthy channel must never authorize three. */
  s_pressure_snapshot.has_stable_pressure = s_pressure_snapshot.p0_stable &&
                                            s_pressure_snapshot.p1_stable &&
                                            s_pressure_snapshot.p2_stable;
  if (s_pressure_snapshot.has_stable_pressure) {
    s_pressure_snapshot.last_stable_ts_ms = esp_timer_get_time() / 1000;
  }
}

static uint32_t calibration_pressure_saturation_mask(int32_t p0, int32_t p1,
                                                     int32_t p2) {
  uint32_t mask = 0u;
  if (sensor_conversion_pressure_raw_is_saturated(p0))
    mask |= 0x01u;
  if (sensor_conversion_pressure_raw_is_saturated(p1))
    mask |= 0x02u;
  if (sensor_conversion_pressure_raw_is_saturated(p2))
    mask |= 0x04u;
  return mask;
}

static sensor_conversion_profile_t
calibration_conversion_profile(const calibration_config_t *calibration) {
  sensor_conversion_profile_t profile = {
      .pressure_baseline_raw =
          {
              calibration->pressure_0_baseline,
              calibration->pressure_1_baseline,
              calibration->pressure_2_baseline,
          },
      .pressure_baseline_valid =
          {
              calibration->pressure_0_baseline != 0,
              calibration->pressure_1_baseline != 0,
              calibration->pressure_2_baseline != 0,
          },
      .pressure_kpa_per_count =
          {
              calibration->pressure_0_kpa_per_count,
              calibration->pressure_1_kpa_per_count,
              calibration->pressure_2_kpa_per_count,
          },
      .hall_baseline_raw = calibration->hall_baseline,
      .hall_baseline_valid = calibration->hall_baseline > 0,
      .hall_range_raw = calibration->hall_range_raw,
      .hall_direction = (int8_t)calibration->hall_direction,
      .full_depth_mm = calibration->full_depth_mm,
      .required_pressure_mask =
          SENSOR_CONVERSION_PRESSURE_DEFAULT_REQUIRED_MASK,
  };
  return profile;
}

static void publish_calibration_progress(calibration_reason_id_t reason_id,
                                         resq_state_t state,
                                         calibration_action_id_t action_id,
                                         int progress_id) {
  bool pressure_kpa_valid =
      s_candidate_config.pressure_valid &&
      !s_candidate_config.pressure_degraded &&
      s_candidate_config.pressure_0_baseline != 0 &&
      s_candidate_config.pressure_1_baseline != 0 &&
      s_candidate_config.pressure_2_baseline != 0 &&
      s_candidate_config.pressure_0_kpa_per_count > 0.0f &&
      s_candidate_config.pressure_1_kpa_per_count > 0.0f &&
      s_candidate_config.pressure_2_kpa_per_count > 0.0f;
  bool hall_mm_valid = s_candidate_config.hall_baseline > 0 &&
                       s_candidate_config.hall_range_raw > 0 &&
                       s_candidate_config.full_depth_mm > 0.0f &&
                       (s_candidate_config.hall_direction == 1 ||
                        s_candidate_config.hall_direction == -1);

  sensor_converted_sample_t converted = {0};
  sensor_conversion_profile_t profile =
      calibration_conversion_profile(&s_candidate_config);
  bool converted_ok = s_has_last_calibration_raw_sample &&
                      sensor_conversion_convert(&s_last_calibration_raw_sample,
                                                &profile, &converted) == ESP_OK;
  bool pressure_0_kpa_valid =
      converted_ok && s_last_calibration_pressure_valid && pressure_kpa_valid &&
      converted.pressure_kpa_channel_valid[0];
  bool pressure_1_kpa_valid =
      converted_ok && s_last_calibration_pressure_valid && pressure_kpa_valid &&
      converted.pressure_kpa_channel_valid[1];
  bool pressure_2_kpa_valid =
      converted_ok && s_last_calibration_pressure_valid && pressure_kpa_valid &&
      converted.pressure_kpa_channel_valid[2];
  bool sample_pressure_kpa_valid =
      pressure_0_kpa_valid && pressure_1_kpa_valid && pressure_2_kpa_valid;
  bool sample_hall_mm_valid = converted_ok && s_last_calibration_hall_valid &&
                              hall_mm_valid && converted.hall_mm_valid;

  char payload[1408];
  const char *reply_id = calibration_manager_get_request_id();
  char reply_segment[160] = {0};
  if (calibration_manager_is_running() && reply_id != NULL &&
      reply_id[0] != '\0') {
    int reply_written = snprintf(reply_segment, sizeof(reply_segment),
                                 "\"reply_id\":\"%s\",", reply_id);
    if (reply_written <= 0 || reply_written >= (int)sizeof(reply_segment)) {
      ESP_LOGE(TAG, "Calibration progress reply_id too large");
      return;
    }
  }

  int written = snprintf(
      payload, sizeof(payload),
      "{"
      "\"event_id\":%d,"
      "%s"
      "\"device_id\":\"%s\","
      "\"progress_id\":%d,"
      "\"reason_id\":\"%s\","
      "\"state\":\"%s\","
      "\"action_id\":%d,"
      "\"pressure_mode\":\"%s\","
      "\"pressure_degraded\":%s,"
      "\"using_last_stable_pressure\":%s,"
      "\"pressure_valid\":%s,"
      "\"hall_valid\":%s,"
      "\"pressure_kpa_valid\":%s,"
      "\"hall_mm_valid\":%s,"
      "\"full_depth_mm\":%.3f,"
      "\"pressure_0_kpa\":%.3f,"
      "\"pressure_0_kpa_valid\":%s,"
      "\"pressure_1_kpa\":%.3f,"
      "\"pressure_1_kpa_valid\":%s,"
      "\"pressure_2_kpa\":%.3f,"
      "\"pressure_2_kpa_valid\":%s,"
      "\"hall_mm\":%.3f,"
      "\"hall_progress\":%.3f,"
      "\"sample_pressure_kpa_valid\":%s,"
      "\"sample_hall_mm_valid\":%s,"
      "\"ts_ms\":%lld"
      "}",
      4001, reply_segment, runtime_helpers_get_device_id(&s_network_config),
      progress_id, calibration_reason_contract_id(reason_id),
      resq_state_to_string(state), (int)action_id,
      calibration_pressure_mode_to_string(s_candidate_config.pressure_mode),
      s_candidate_config.pressure_degraded ? "true" : "false",
      s_candidate_config.using_last_stable_pressure ? "true" : "false",
      s_candidate_config.pressure_valid ? "true" : "false",
      s_candidate_config.hall_valid ? "true" : "false",
      pressure_kpa_valid ? "true" : "false", hall_mm_valid ? "true" : "false",
      s_candidate_config.full_depth_mm,
      pressure_0_kpa_valid ? converted.pressure_kpa[0] : 0.0f,
      pressure_0_kpa_valid ? "true" : "false",
      pressure_1_kpa_valid ? converted.pressure_kpa[1] : 0.0f,
      pressure_1_kpa_valid ? "true" : "false",
      pressure_2_kpa_valid ? converted.pressure_kpa[2] : 0.0f,
      pressure_2_kpa_valid ? "true" : "false",
      sample_hall_mm_valid ? converted.hall_mm : 0.0f,
      sample_hall_mm_valid ? converted.hall_progress : 0.0f,
      sample_pressure_kpa_valid ? "true" : "false",
      sample_hall_mm_valid ? "true" : "false",
      (long long)(esp_timer_get_time() / 1000));

  if (written <= 0 || written >= (int)sizeof(payload)) {
    ESP_LOGE(TAG, "Calibration progress payload too large");
    return;
  }

  if (mqtt_manager_is_connected()) {
    mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION, payload);
  }
}

/**
 * @brief Return absolute difference between two int32_t values.
 */
static int32_t calibration_abs_diff(int32_t a, int32_t b) {
  int64_t diff = (int64_t)a - (int64_t)b;
  if (diff < 0) diff = -diff;
  return diff > INT32_MAX ? INT32_MAX : (int32_t)diff;
}

/**
 * @brief Check whether a reading is inside target +/- tolerance.
 */
static bool calibration_is_within_tolerance(int32_t reading, int32_t target,
                                            int32_t tolerance) {
  return calibration_abs_diff(reading, target) <= tolerance;
}

/**
 * @brief Detect 24-bit ADC saturation sentinel values used by HX710.
 */
static bool calibration_is_saturated_24bit(int32_t value) {
  return sensor_conversion_pressure_raw_is_saturated(value);
}

/* Calibration signal stats type (full definition needed by functions that
 * access fields) */
typedef struct calibration_signal_stats_t {
  int64_t sum;
  int32_t mean;
  int32_t min;
  int32_t max;
  int32_t
      noise_pp; /* trimmed peak-to-peak spread, resistant to isolated spikes */
  int32_t last;
  int valid_count;
  int32_t samples[CALIBRATION_MAX_STATS_SAMPLES];
} calibration_signal_stats_t;

typedef struct calibration_sample_t {
  int32_t hall;
  int32_t p0;
  int32_t p1;
  int32_t p2;
  bool pressure_valid;
} calibration_sample_t;

/* Forward prototypes for static helpers defined later */
static void calibration_stats_init(calibration_signal_stats_t *s);
static void calibration_stats_update(calibration_signal_stats_t *s,
                                     int32_t value);
static void calibration_stats_finalize(calibration_signal_stats_t *s);
static void calibration_sort_i32(int32_t *values, int count);
static int32_t calibration_max_i32(int32_t a, int32_t b);
static int32_t calibration_min_i32(int32_t a, int32_t b);
static int32_t calibration_abs_i32(int32_t v);
static int32_t calibration_adaptive_pressure_tolerance(int32_t target,
                                                       int32_t noise_raw);
static int32_t calibration_adaptive_hall_tolerance(int32_t hall_range,
                                                   int32_t noise_raw);
static esp_err_t calibration_read_hall_average(int32_t *out_value);
static esp_err_t calibration_validate_pressure_triplet(int32_t v0, int32_t v1,
                                                       int32_t v2);
static esp_err_t
calibration_read_valid_sample(calibration_sample_t *out_sample);
static esp_err_t
calibration_read_hall_pressure_sample(calibration_sample_t *out_sample);
static esp_err_t calibration_read_pressure_average(gpio_num_t sck_pin,
                                                   gpio_num_t dout_pin,
                                                   int32_t *out_value);
static calibration_reason_id_t calibration_validate_derived_thresholds(void);
static calibration_reason_id_t calibration_validate_pressure_rest_health(
    const calibration_signal_stats_t *p0_stats,
    const calibration_signal_stats_t *p1_stats,
    const calibration_signal_stats_t *p2_stats);
static esp_err_t calibration_capture_full_press_batch(int hall_direction,
                                                      int32_t hold_boundary,
                                                      int32_t *out_hall,
                                                      int32_t *out_p1,
                                                      int32_t *out_p2);
static bool calibration_is_saturated_24bit(int32_t value);
static calibration_reason_id_t
calibration_validate_pressure_rest_health(const calibration_signal_stats_t *p0,
                                          const calibration_signal_stats_t *p1,
                                          const calibration_signal_stats_t *p2);

static void calibration_record_progress_sample(int32_t hall_raw, int32_t p0,
                                               int32_t p1, int32_t p2,
                                               bool pressure_valid,
                                               bool hall_valid) {
  memset(&s_last_calibration_raw_sample, 0,
         sizeof(s_last_calibration_raw_sample));
  s_last_calibration_raw_sample.pressure_raw[0] = p0;
  s_last_calibration_raw_sample.pressure_raw[1] = p1;
  s_last_calibration_raw_sample.pressure_raw[2] = p2;
  s_last_calibration_raw_sample.pressure_read_valid[0] = pressure_valid;
  s_last_calibration_raw_sample.pressure_read_valid[1] = pressure_valid;
  s_last_calibration_raw_sample.pressure_read_valid[2] = pressure_valid;
  s_last_calibration_raw_sample.hall_raw = hall_raw;
  s_last_calibration_raw_sample.hall_read_valid = hall_valid;
  s_last_calibration_raw_sample.pressure_saturation_mask =
      pressure_valid ? calibration_pressure_saturation_mask(p0, p1, p2) : 0u;
  s_last_calibration_raw_sample.timestamp_ms = esp_timer_get_time() / 1000;
  s_last_calibration_pressure_valid = pressure_valid;
  s_last_calibration_hall_valid = hall_valid;
  s_has_last_calibration_raw_sample = true;
}

/* Collect rest statistics for Hall and the three pressure sensors.
 * Caller must ensure s_candidate_config.calibration_sample_count and
 * calibration_window_ms are set to sensible values (defaults provided).
 */
static esp_err_t
calibration_collect_rest_stats(calibration_signal_stats_t *hall_stats,
                               calibration_signal_stats_t *p0_stats,
                               calibration_signal_stats_t *p1_stats,
                               calibration_signal_stats_t *p2_stats) {
  if (!hall_stats || !p0_stats || !p1_stats || !p2_stats)
    return ESP_ERR_INVALID_ARG;

  calibration_stats_init(hall_stats);
  calibration_stats_init(p0_stats);
  calibration_stats_init(p1_stats);
  calibration_stats_init(p2_stats);

  int sample_count = s_candidate_config.calibration_sample_count > 0
                         ? s_candidate_config.calibration_sample_count
                         : CALIBRATION_REST_OBSERVATIONS;
  if (sample_count < CALIBRATION_REST_OBSERVATIONS) {
    sample_count = CALIBRATION_REST_OBSERVATIONS;
  }
  if (sample_count > CALIBRATION_MAX_STATS_SAMPLES) {
    ESP_LOGW(TAG, "Calibration sample count %d capped at %d", sample_count,
             CALIBRATION_MAX_STATS_SAMPLES);
    sample_count = CALIBRATION_MAX_STATS_SAMPLES;
  }
  s_candidate_config.calibration_sample_count = sample_count;

  int window_ms = s_candidate_config.calibration_window_ms > 0
                      ? s_candidate_config.calibration_window_ms
                      : 2000;
  int delay_ms = window_ms / sample_count;
  if (delay_ms < 5)
    delay_ms = 5;

  int max_attempts =
      (sample_count * 100 + (100 - CALIBRATION_MAX_INVALID_PERCENT) - 1) /
      (100 - CALIBRATION_MAX_INVALID_PERCENT);
  int attempts = 0;
  int valid = 0;

  while (valid < sample_count && attempts < max_attempts && s_running) {
    calibration_sample_t sample = {0};
    attempts++;

    esp_err_t err = calibration_read_valid_sample(&sample);
    if (err == ESP_OK) {
      calibration_stats_update(hall_stats, sample.hall);
      calibration_stats_update(p0_stats, sample.p0);
      calibration_stats_update(p1_stats, sample.p1);
      calibration_stats_update(p2_stats, sample.p2);
      valid++;
    } else {
      ESP_LOGW(TAG, "Discarding invalid rest observation %d/%d: %s", attempts,
               max_attempts, esp_err_to_name(err));
    }

    if (calibration_delay_or_cancel(delay_ms) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  if (!s_running) {
    return ESP_ERR_INVALID_STATE;
  }

  if (valid < sample_count) {
    ESP_LOGW(TAG,
             "Insufficient valid rest observations: valid=%d required=%d "
             "attempts=%d max_attempts=%d",
             valid, sample_count, attempts, max_attempts);
    return ESP_ERR_INVALID_RESPONSE;
  }

  calibration_stats_finalize(hall_stats);
  calibration_stats_finalize(p0_stats);
  calibration_stats_finalize(p1_stats);
  calibration_stats_finalize(p2_stats);

  ESP_LOGI(
      TAG,
      "Collected stable baseline observations: valid=%d attempts=%d invalid=%d",
      valid, attempts, attempts - valid);

  return ESP_OK;
}

static esp_err_t calibration_capture_full_press_batch(int hall_direction,
                                                      int32_t hold_boundary,
                                                      int32_t *out_hall,
                                                      int32_t *out_p1,
                                                      int32_t *out_p2) {
  if ((hall_direction != 1 && hall_direction != -1) || out_hall == NULL ||
      out_p1 == NULL || out_p2 == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  calibration_signal_stats_t hall_stats;
  calibration_signal_stats_t p0_stats;
  calibration_signal_stats_t p1_stats;
  calibration_signal_stats_t p2_stats;
  calibration_stats_init(&hall_stats);
  calibration_stats_init(&p0_stats);
  calibration_stats_init(&p1_stats);
  calibration_stats_init(&p2_stats);

  const int max_attempts = (CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES * 100 +
                            (100 - CALIBRATION_MAX_INVALID_PERCENT) - 1) /
                           (100 - CALIBRATION_MAX_INVALID_PERCENT);
  int attempts = 0;
  int valid = 0;

  while (valid < CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES &&
         attempts < max_attempts && s_running) {
    calibration_sample_t sample = {0};
    attempts++;

    esp_err_t err = calibration_read_hall_pressure_sample(&sample);
    if (err != ESP_OK) {
      ESP_LOGW(TAG, "Discarding invalid full-press observation %d/%d: %s",
               attempts, max_attempts, esp_err_to_name(err));
      if (calibration_delay_or_cancel(CALIBRATION_CAPTURE_SAMPLE_DELAY_MS) !=
          ESP_OK) {
        return ESP_ERR_INVALID_STATE;
      }
      continue;
    }

    int32_t directional_delta =
        (sample.hall - s_candidate_config.hall_baseline) * hall_direction;
    if (directional_delta < hold_boundary) {
      ESP_LOGW(
          TAG,
          "Full press released during capture: delta=%ld boundary=%ld valid=%d",
          (long)directional_delta, (long)hold_boundary, valid);
      return ESP_ERR_INVALID_STATE;
    }

    calibration_stats_update(&hall_stats, sample.hall);
    if (sample.pressure_valid) {
      calibration_stats_update(&p0_stats, sample.p0);
      calibration_stats_update(&p1_stats, sample.p1);
      calibration_stats_update(&p2_stats, sample.p2);
    }
    valid++;

    if (calibration_delay_or_cancel(CALIBRATION_CAPTURE_SAMPLE_DELAY_MS) !=
        ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  if (!s_running) {
    return ESP_ERR_INVALID_STATE;
  }

  if (valid < CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES) {
    ESP_LOGW(TAG,
             "Insufficient valid full-press observations: valid=%d required=%d "
             "attempts=%d",
             valid, CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES, attempts);
    return ESP_ERR_INVALID_RESPONSE;
  }

  calibration_stats_finalize(&hall_stats);
  if (p1_stats.valid_count > 0 && p2_stats.valid_count > 0) {
    calibration_stats_finalize(&p0_stats);
    calibration_stats_finalize(&p1_stats);
    calibration_stats_finalize(&p2_stats);
  } else {
    p1_stats.mean = s_candidate_config.pressure_1_baseline;
    p2_stats.mean = s_candidate_config.pressure_2_baseline;
    p1_stats.noise_pp = s_candidate_config.pressure_1_noise_raw;
    p2_stats.noise_pp = s_candidate_config.pressure_2_noise_raw;
    calibration_mark_pressure_degraded(s_pressure_snapshot.has_stable_pressure);
  }

  *out_hall = hall_stats.mean;
  *out_p1 = p1_stats.mean;
  *out_p2 = p2_stats.mean;

  ESP_LOGI(TAG,
           "Stable full-press batch: hall=%ld p1=%ld p2=%ld hall_noise=%ld "
           "p1_noise=%ld p2_noise=%ld",
           (long)hall_stats.mean, (long)p1_stats.mean, (long)p2_stats.mean,
           (long)hall_stats.noise_pp, (long)p1_stats.noise_pp,
           (long)p2_stats.noise_pp);

  return ESP_OK;
}

/* Collect full-press stats: require a sustained Hall threshold crossing, then
 * capture a stable trimmed batch while the operator continues holding.
 */
static esp_err_t calibration_collect_full_press_stats(
    int32_t expected_delta, int32_t *out_hall_match, int32_t *out_b1_full,
    int32_t *out_b2_full, calibration_signal_stats_t *rest_hall_stats,
    calibration_reason_id_t *out_failure_reason) {
  if (out_failure_reason != NULL) {
    *out_failure_reason = CAL_REASON_NONE;
  }

  if (out_hall_match == NULL || out_b1_full == NULL || out_b2_full == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  /* Make the expected delta direction-safe and validate it's large enough */
  int32_t expected_range = calibration_abs_i32(expected_delta);
  if (expected_range < CALIBRATION_HALL_DELTA_MIN_RAW ||
      expected_range > CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS) {
    ESP_LOGW(TAG, "Expected hall delta outside supported range %d..%d: %ld",
             CALIBRATION_HALL_DELTA_MIN_RAW,
             CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS, (long)expected_range);
    return ESP_ERR_INVALID_ARG;
  }

  /* compute initial adaptive thresholds using expected range and measured noise
   */
  int32_t hall_noise = rest_hall_stats ? rest_hall_stats->noise_pp : 0;
  int32_t hall_noise_margin = calibration_max_i32(
      hall_noise * CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER, 20);
  int32_t hall_hysteresis = calibration_max_i32(hall_noise * 2, 10);

  int32_t start_thresh = calibration_max_i32(
      (expected_range * CALIBRATION_FULL_PRESS_START_RATIO_PCT) / 100,
      hall_noise_margin);
  int32_t full_thresh = calibration_max_i32(
      (expected_range * CALIBRATION_FULL_PRESS_CANDIDATE_RATIO_PCT) / 100,
      start_thresh + hall_hysteresis);
  if (full_thresh > expected_range) {
    full_thresh = expected_range;
  }
  int32_t recoil_thresh = calibration_max_i32(
      (expected_range * 10) / 100, calibration_max_i32(hall_noise * 2, 10));
  if (recoil_thresh >= start_thresh) {
    recoil_thresh = calibration_max_i32(1, start_thresh / 2);
  }

  ESP_LOGI(TAG, "Adaptive detection: start=%ld full=%ld recoil=%ld noise=%ld",
           (long)start_thresh, (long)full_thresh, (long)recoil_thresh,
           (long)hall_noise);

  int64_t started_ms = esp_timer_get_time() / 1000;
  int32_t peak_delta = 0;
  int32_t peak_hall_value = s_candidate_config.hall_baseline;
  int hold_count = 0;
  int hold_dir = 0;
  int last_log_ms = -500; /* throttle live logs to every 500ms */
  int32_t hold_boundary = calibration_max_i32(1, full_thresh - hall_hysteresis);

  while (s_running) {
    int elapsed_ms = (int)((esp_timer_get_time() / 1000) - started_ms);
    if (elapsed_ms >= CALIBRATION_MAX_WAIT_MS) {
      break;
    }

    calibration_sample_t sample = {0};
    esp_err_t err = calibration_read_hall_pressure_sample(&sample);
    if (err != ESP_OK) {
      hold_count = 0;
      hold_dir = 0;
      ESP_LOGW(TAG, "Sensor read failed during full-press wait: %s",
               esp_err_to_name(err));
      if (calibration_delay_or_cancel(CALIBRATION_POLL_DELAY_MS) != ESP_OK) {
        return ESP_ERR_INVALID_STATE;
      }
      continue;
    }
    if (!sample.pressure_valid && calibration_pressure_is_optional()) {
      bool was_degraded = s_candidate_config.pressure_degraded;
      calibration_mark_pressure_degraded(
          s_pressure_snapshot.has_stable_pressure);
      if (!was_degraded) {
        publish_calibration_progress(
            CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
            RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 9);
      }
    }

    int32_t hv = sample.hall;
    int32_t delta =
        calibration_abs_diff(hv, s_candidate_config.hall_baseline);
    int sample_dir = hv >= s_candidate_config.hall_baseline ? 1 : -1;
    if (delta > peak_delta) {
      peak_delta = delta;
      peak_hall_value = hv;
    }

    if (delta >= full_thresh) {
      if (hold_count == 0 || sample_dir == hold_dir) {
        hold_dir = sample_dir;
        hold_count++;
      } else {
        hold_dir = sample_dir;
        hold_count = 1;
      }
    } else {
      hold_count = 0;
      hold_dir = 0;
    }

    /* Throttled live logging for debugging during full-press wait */
    if ((elapsed_ms - last_log_ms) >= 500) {
      ESP_LOGI(TAG,
               "Hall full-press wait: hall=%ld baseline=%ld delta=%ld "
               "peak_delta=%ld required=%ld "
               "p1_delta=%ld p2_delta=%ld hold=%d/%d elapsed=%d",
               (long)hv, (long)s_candidate_config.hall_baseline, (long)delta,
               (long)peak_delta, (long)full_thresh,
               sample.pressure_valid
                   ? (long)calibration_abs_diff(
                         sample.p1, s_candidate_config.pressure_1_baseline)
                   : -1L,
               sample.pressure_valid
                   ? (long)calibration_abs_diff(
                         sample.p2, s_candidate_config.pressure_2_baseline)
                   : -1L,
               hold_count, CALIBRATION_FULL_PRESS_HOLD_SAMPLES, elapsed_ms);
      last_log_ms = elapsed_ms;
    }

    if (hold_count >= CALIBRATION_FULL_PRESS_HOLD_SAMPLES) {
      ESP_LOGI(TAG,
               "Full press confirmed; capturing %d stable observations above "
               "delta %ld",
               CALIBRATION_FULL_PRESS_CAPTURE_SAMPLES, (long)hold_boundary);

      err = calibration_capture_full_press_batch(
          hold_dir, hold_boundary, out_hall_match, out_b1_full, out_b2_full);
      if (err == ESP_OK) {
        int32_t captured_delta =
            (*out_hall_match - s_candidate_config.hall_baseline) * hold_dir;
        int32_t min_final =
            (expected_range * CALIBRATION_FULL_PRESS_FINAL_MIN_PCT) / 100;
        int32_t max_final =
            (expected_range * CALIBRATION_FULL_PRESS_FINAL_MAX_PCT) / 100;
        int32_t available_range = hold_dir > 0
                                      ? CALIBRATION_HALL_ADC_MAX_RAW -
                                            s_candidate_config.hall_baseline
                                      : s_candidate_config.hall_baseline;
        if (expected_range > available_range) {
          ESP_LOGE(TAG,
                   "Hall delta %ld exceeds reachable range %ld from baseline "
                   "%ld direction=%d",
                   (long)expected_range, (long)available_range,
                   (long)s_candidate_config.hall_baseline, hold_dir);
          if (out_failure_reason != NULL) {
            *out_failure_reason = CAL_REASON_INVALID_HALL_DELTA;
          }
          return ESP_ERR_INVALID_ARG;
        }
        if (captured_delta < min_final || captured_delta > max_final) {
          ESP_LOGE(TAG,
                   "Captured Hall full press outside tolerance: delta=%ld "
                   "expected=%ld min=%ld max=%ld direction=%d",
                   (long)captured_delta, (long)expected_range, (long)min_final,
                   (long)max_final, hold_dir);
          if (out_failure_reason != NULL) {
            *out_failure_reason =
                captured_delta < min_final
                    ? CAL_REASON_HALL_RANGE_TOO_SMALL
                    : CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE;
          }
          return ESP_ERR_INVALID_RESPONSE;
        }
        s_candidate_config.hall_direction = hold_dir;
        return ESP_OK;
      }

      if (!s_running) {
        return ESP_ERR_INVALID_STATE;
      }

      if (err == ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG,
                 "Full press was not held; waiting for another stable press");
        hold_count = 0;
        hold_dir = 0;
        continue;
      }

      return err;
    }

    if (calibration_delay_or_cancel(CALIBRATION_POLL_DELAY_MS) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  ESP_LOGE(TAG,
           "Hall full press timeout: peak_delta=%ld peak_hall=%ld baseline=%ld "
           "required=%ld",
           (long)peak_delta, (long)peak_hall_value,
           (long)s_candidate_config.hall_baseline, (long)full_thresh);

  if (peak_delta <= hall_noise_margin) {
    ESP_LOGE(TAG,
             "No Hall movement exceeded noise margin %ld; check Hall power, "
             "ADC channel wiring, and magnet alignment",
             (long)hall_noise_margin);
    if (out_failure_reason != NULL) {
      *out_failure_reason = CAL_REASON_HALL_RANGE_TOO_SMALL;
    }
  } else if (out_failure_reason != NULL) {
    *out_failure_reason = CAL_REASON_HALL_FULL_PRESS_TIMEOUT;
  }

  return ESP_ERR_TIMEOUT;
}

/* Derive adaptive thresholds and populate s_candidate_config accordingly. */
static void calibration_derive_adaptive_thresholds(
    const calibration_signal_stats_t *hall_stats,
    const calibration_signal_stats_t *p0_stats,
    const calibration_signal_stats_t *p1_stats,
    const calibration_signal_stats_t *p2_stats, int32_t matched_hall_full,
    int32_t matched_b1_full, int32_t matched_b2_full) {
  if (hall_stats == NULL || p0_stats == NULL || p1_stats == NULL ||
      p2_stats == NULL)
    return;

  /* Hall baseline and noise */
  s_candidate_config.hall_baseline = hall_stats->mean;
  s_candidate_config.hall_noise_raw = hall_stats->noise_pp;

  /* Pressure baselines and noise */
  s_candidate_config.pressure_0_baseline = p0_stats->mean;
  s_candidate_config.pressure_1_baseline = p1_stats->mean;
  s_candidate_config.pressure_2_baseline = p2_stats->mean;

  s_candidate_config.pressure_0_noise_raw = p0_stats->noise_pp;
  s_candidate_config.pressure_1_noise_raw = p1_stats->noise_pp;
  s_candidate_config.pressure_2_noise_raw = p2_stats->noise_pp;

  /* Captured full-press values */
  s_candidate_config.hall_full_press = matched_hall_full;
  s_candidate_config.bladder_1_full_press = matched_b1_full;
  s_candidate_config.bladder_2_full_press = matched_b2_full;

  /* hall range & direction */
  s_candidate_config.hall_range_raw = calibration_abs_diff(
      matched_hall_full, s_candidate_config.hall_baseline);
  s_candidate_config.hall_direction =
      (matched_hall_full > s_candidate_config.hall_baseline) ? 1 : -1;

  int32_t hall_noise_margin =
      calibration_max_i32(s_candidate_config.hall_noise_raw *
                              CALIBRATION_HALL_NOISE_MARGIN_MULTIPLIER,
                          20);
  int32_t hall_hysteresis =
      calibration_max_i32(s_candidate_config.hall_noise_raw * 2, 10);

  s_candidate_config.hall_start_delta = calibration_max_i32(
      (s_candidate_config.hall_range_raw * 15) / 100, hall_noise_margin);
  s_candidate_config.hall_full_delta_threshold = calibration_max_i32(
      (s_candidate_config.hall_range_raw * 85) / 100,
      s_candidate_config.hall_start_delta + hall_hysteresis);
  if (s_candidate_config.hall_full_delta_threshold >
      s_candidate_config.hall_range_raw) {
    s_candidate_config.hall_full_delta_threshold =
        s_candidate_config.hall_range_raw;
  }
  s_candidate_config.hall_recoil_delta = calibration_max_i32(
      (s_candidate_config.hall_range_raw * 10) / 100,
      calibration_max_i32(s_candidate_config.hall_noise_raw * 2, 10));
  if (s_candidate_config.hall_recoil_delta >=
      s_candidate_config.hall_start_delta) {
    s_candidate_config.hall_recoil_delta =
        calibration_max_i32(1, s_candidate_config.hall_start_delta / 2);
  }
  s_candidate_config.hall_tolerance_raw = calibration_adaptive_hall_tolerance(
      s_candidate_config.hall_range_raw, s_candidate_config.hall_noise_raw);

  /* pressure ranges: compute from measured baselines (not host-provided
   * expected values) */
  s_candidate_config.pressure_1_range_raw =
      calibration_abs_diff(s_candidate_config.bladder_1_full_press,
                           s_candidate_config.pressure_1_baseline);
  s_candidate_config.pressure_2_range_raw =
      calibration_abs_diff(s_candidate_config.bladder_2_full_press,
                           s_candidate_config.pressure_2_baseline);

  if (!s_candidate_config.pressure_valid) {
    s_candidate_config.pressure_1_range_raw = 0;
    s_candidate_config.pressure_2_range_raw = 0;
    s_candidate_config.pressure_contact_threshold = 0;
    s_candidate_config.pressure_valid_threshold = 0;
    s_candidate_config.calibrated_at_ms =
        (int64_t)(esp_timer_get_time() / 1000);
    ESP_LOGW(TAG,
             "Derived Hall-only thresholds: hall_range=%ld start=%ld full=%ld "
             "recoil=%ld pressure_mode=%s",
             (long)s_candidate_config.hall_range_raw,
             (long)s_candidate_config.hall_start_delta,
             (long)s_candidate_config.hall_full_delta_threshold,
             (long)s_candidate_config.hall_recoil_delta,
             calibration_pressure_mode_to_string(
                 s_candidate_config.pressure_mode));
    return;
  }

  int32_t max_noise =
      calibration_max_i32(s_candidate_config.pressure_1_noise_raw,
                          s_candidate_config.pressure_2_noise_raw);
  int32_t pressure_contact_min = 100;
  s_candidate_config.pressure_contact_threshold = calibration_max_i32(
      max_noise * CALIBRATION_PRESSURE_CONTACT_NOISE_MULTIPLIER,
      pressure_contact_min);

  /* Use the smaller reliable pressure range for pressure_valid_threshold when
   * both sensors are used */
  int32_t min_range = calibration_max_i32(
      1, calibration_min_i32(s_candidate_config.pressure_1_range_raw,
                             s_candidate_config.pressure_2_range_raw));
  s_candidate_config.pressure_valid_threshold = calibration_max_i32(
      (min_range * 70) / 100, s_candidate_config.pressure_contact_threshold +
                                  calibration_max_i32(max_noise, 1));

  /* sample/window already set in config; record timestamp */
  s_candidate_config.calibrated_at_ms =
      (int64_t)(esp_timer_get_time() / 1000);

  ESP_LOGI(TAG,
           "Derived adaptive thresholds: hall_range=%ld start=%ld full=%ld "
           "recoil=%ld p1_range=%ld p2_range=%ld p_valid=%ld p_contact=%ld",
           (long)s_candidate_config.hall_range_raw,
           (long)s_candidate_config.hall_start_delta,
           (long)s_candidate_config.hall_full_delta_threshold,
           (long)s_candidate_config.hall_recoil_delta,
           (long)s_candidate_config.pressure_1_range_raw,
           (long)s_candidate_config.pressure_2_range_raw,
           (long)s_candidate_config.pressure_valid_threshold,
           (long)s_candidate_config.pressure_contact_threshold);
}

/* Validate derived adaptive thresholds and return a calibration reason id on
 * failure */
static calibration_reason_id_t calibration_validate_derived_thresholds(void) {
  const int32_t MIN_HALL_RANGE = 30;
  const int32_t MIN_PRESSURE_RANGE = 300;

  if (s_candidate_config.hall_range_raw < MIN_HALL_RANGE) {
    return CAL_REASON_HALL_RANGE_TOO_SMALL;
  }

  if ((int64_t)s_candidate_config.hall_noise_raw * 4 >=
      (int64_t)s_candidate_config.hall_range_raw) {
    return CAL_REASON_HALL_NOISE_TOO_HIGH;
  }

  if (s_candidate_config.hall_start_delta <= 0)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
  if (s_candidate_config.hall_full_delta_threshold <=
      s_candidate_config.hall_start_delta)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
  if (s_candidate_config.hall_full_delta_threshold >
      s_candidate_config.hall_range_raw)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
  if (s_candidate_config.hall_recoil_delta <= 0)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;
  if (s_candidate_config.hall_recoil_delta >=
      s_candidate_config.hall_start_delta)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

  bool pressure_required =
      s_candidate_config.pressure_mode == CALIBRATION_PRESSURE_REQUIRED;
  if (!s_candidate_config.pressure_valid && !pressure_required) {
    return CAL_REASON_NONE;
  }

  if (s_candidate_config.pressure_1_range_raw < MIN_PRESSURE_RANGE)
    return CAL_REASON_PRESSURE_RANGE_TOO_SMALL;
  if (s_candidate_config.pressure_2_range_raw < MIN_PRESSURE_RANGE)
    return CAL_REASON_PRESSURE_RANGE_TOO_SMALL;

  int32_t min_pressure_range =
      calibration_min_i32(s_candidate_config.pressure_1_range_raw,
                          s_candidate_config.pressure_2_range_raw);
  if ((int64_t)s_candidate_config.pressure_1_noise_raw *
          CALIBRATION_PRESSURE_MIN_SNR_MULTIPLIER >=
      (int64_t)s_candidate_config.pressure_1_range_raw) {
    return CAL_REASON_PRESSURE_NOISE_TOO_HIGH;
  }
  if ((int64_t)s_candidate_config.pressure_2_noise_raw *
          CALIBRATION_PRESSURE_MIN_SNR_MULTIPLIER >=
      (int64_t)s_candidate_config.pressure_2_range_raw) {
    return CAL_REASON_PRESSURE_NOISE_TOO_HIGH;
  }

  if (s_candidate_config.pressure_valid_threshold <=
      s_candidate_config.pressure_contact_threshold)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

  if (s_candidate_config.pressure_valid_threshold > min_pressure_range)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

  if (s_candidate_config.pressure_balance_allowed_pct < 5 ||
      s_candidate_config.pressure_balance_allowed_pct > 60)
    return CAL_REASON_ADAPTIVE_THRESHOLD_INVALID;

  return CAL_REASON_NONE;
}

/* =========================================================
 * Calibration statistics helpers
 * ========================================================= */
static void calibration_stats_init(calibration_signal_stats_t *s) {
  if (s == NULL)
    return;
  s->sum = 0;
  s->mean = 0;
  s->min = INT32_MAX;
  s->max = INT32_MIN;
  s->noise_pp = 0;
  s->last = 0;
  s->valid_count = 0;
  memset(s->samples, 0, sizeof(s->samples));
}

static void calibration_stats_update(calibration_signal_stats_t *s,
                                     int32_t value) {
  if (s == NULL)
    return;
  if (s->valid_count >= CALIBRATION_MAX_STATS_SAMPLES)
    return;
  s->sum += value;
  s->last = value;
  if (value < s->min)
    s->min = value;
  if (value > s->max)
    s->max = value;
  s->samples[s->valid_count] = value;
  s->valid_count++;
}

static void calibration_stats_finalize(calibration_signal_stats_t *s) {
  if (s == NULL || s->valid_count == 0)
    return;

  calibration_sort_i32(s->samples, s->valid_count);

  int trim_count = (s->valid_count * CALIBRATION_NOISE_TRIM_PERCENT) / 100;
  if ((s->valid_count - (trim_count * 2)) < 5) {
    trim_count = 0;
  }

  int first = trim_count;
  int last = s->valid_count - trim_count - 1;
  int64_t robust_sum = 0;
  for (int i = first; i <= last; i++) {
    robust_sum += s->samples[i];
  }

  int robust_count = last - first + 1;
  s->mean = (int32_t)(robust_sum / robust_count);

  int64_t robust_span = (int64_t)s->samples[last] - (int64_t)s->samples[first];
  s->noise_pp = robust_span > INT32_MAX ? INT32_MAX : (int32_t)robust_span;
}

static void calibration_sort_i32(int32_t *values, int count) {
  if (values == NULL || count < 2)
    return;

  for (int i = 1; i < count; i++) {
    int32_t current = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > current) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = current;
  }
}

static int32_t calibration_max_i32(int32_t a, int32_t b) {
  return a >= b ? a : b;
}

static int32_t calibration_min_i32(int32_t a, int32_t b) {
  return a <= b ? a : b;
}

static int32_t calibration_abs_i32(int32_t v) {
  int64_t wide = v;
  if (wide < 0) wide = -wide;
  return wide > INT32_MAX ? INT32_MAX : (int32_t)wide;
}

/* Adaptive tolerance helpers (used during calibration decisions) */
static int32_t calibration_adaptive_pressure_tolerance(int32_t target,
                                                       int32_t noise_raw) {
  int32_t pct_tol = (int32_t)(((int64_t)calibration_abs_i32(target) * 8) / 100);
  int32_t noise_tol = (int32_t)(((int64_t)calibration_abs_i32(noise_raw) * 5) > INT32_MAX
                                    ? INT32_MAX
                                    : (int64_t)calibration_abs_i32(noise_raw) * 5);
  int32_t min_tol = 100;
  int32_t t =
      calibration_max_i32(min_tol, calibration_max_i32(pct_tol, noise_tol));
  return t;
}

static int32_t calibration_adaptive_hall_tolerance(int32_t hall_range,
                                                   int32_t noise_raw) {
  int32_t pct_tol = (int32_t)(((int64_t)calibration_abs_i32(hall_range) * 5) / 100);
  int32_t noise_tol = (int32_t)(((int64_t)calibration_abs_i32(noise_raw) * 4) > INT32_MAX
                                    ? INT32_MAX
                                    : (int64_t)calibration_abs_i32(noise_raw) * 4);
  int32_t min_tol = 20;
  int32_t t =
      calibration_max_i32(min_tol, calibration_max_i32(pct_tol, noise_tol));
  return t;
}

static esp_err_t calibration_validate_pressure_triplet(int32_t v0, int32_t v1,
                                                       int32_t v2) {
  s_last_hx710_raw[0] = v0;
  s_last_hx710_raw[1] = v1;
  s_last_hx710_raw[2] = v2;

  if (calibration_is_saturated_24bit(v0) ||
      calibration_is_saturated_24bit(v1) ||
      calibration_is_saturated_24bit(v2)) {
    memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
    return ESP_ERR_INVALID_RESPONSE;
  }

  int32_t values[3] = {v0, v1, v2};
  for (int i = 0; i < 3; i++) {
    if (values[i] >= -CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW &&
        values[i] <= CALIBRATION_STUCK_ZERO_NEAR_ZERO_RAW) {
      s_hx710_zero_streaks[i]++;
    } else {
      s_hx710_zero_streaks[i] = 0;
    }

    if (s_hx710_zero_streaks[i] == CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT) {
      if (i == 0) {
        ESP_LOGW(TAG,
                 "pressure_sensor_0 appears stuck or near zero; check DOUT "
                 "wiring/GPIO%d/HX710 module",
                 (int)BOARD_HX710_0_DOUT);
      } else if (i == 1) {
        ESP_LOGE(TAG,
                 "pressure_sensor_1 appears stuck at zero; check DOUT "
                 "wiring/GPIO%d/HX710 module",
                 (int)BOARD_HX710_1_DOUT);
      } else {
        ESP_LOGE(TAG,
                 "pressure_sensor_2 appears stuck at zero; check DOUT "
                 "wiring/GPIO%d/HX710 module",
                 (int)BOARD_HX710_2_DOUT);
      }
    }

    if (i > 0 &&
        s_hx710_zero_streaks[i] >= CALIBRATION_STUCK_ZERO_THRESHOLD_COUNT) {
      return ESP_ERR_INVALID_RESPONSE;
    }
  }

  return ESP_OK;
}

static esp_err_t
calibration_read_valid_sample(calibration_sample_t *out_sample) {
  if (out_sample == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  memset(out_sample, 0, sizeof(*out_sample));

  esp_err_t err = calibration_read_hall_average(&out_sample->hall);
  if (err != ESP_OK) {
    return err;
  }

  err = hx710_read_3_shared_sck(
      BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT, BOARD_HX710_1_DOUT,
      BOARD_HX710_2_DOUT, &out_sample->p0, &out_sample->p1, &out_sample->p2);
  if (err != ESP_OK) {
    memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
    calibration_record_progress_sample(out_sample->hall, 0, 0, 0, false, true);
    return err;
  }

  err = calibration_validate_pressure_triplet(out_sample->p0, out_sample->p1,
                                              out_sample->p2);
  out_sample->pressure_valid = err == ESP_OK;
  calibration_record_progress_sample(out_sample->hall, out_sample->p0,
                                     out_sample->p1, out_sample->p2,
                                     out_sample->pressure_valid, true);
  return err;
}

static esp_err_t
calibration_read_hall_pressure_sample(calibration_sample_t *out_sample) {
  if (out_sample == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  memset(out_sample, 0, sizeof(*out_sample));

  esp_err_t hall_err = calibration_read_hall_average(&out_sample->hall);
  if (hall_err != ESP_OK) {
    return hall_err;
  }

  if (s_candidate_config.pressure_mode == CALIBRATION_HALL_ONLY ||
      s_candidate_config.pressure_degraded) {
    out_sample->pressure_valid = false;
    calibration_record_progress_sample(out_sample->hall, 0, 0, 0, false, true);
    return ESP_OK;
  }

  esp_err_t pressure_err = hx710_read_3_shared_sck(
      BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT, BOARD_HX710_1_DOUT,
      BOARD_HX710_2_DOUT, &out_sample->p0, &out_sample->p1, &out_sample->p2);
  if (pressure_err != ESP_OK) {
    memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
    out_sample->pressure_valid = false;
    calibration_record_progress_sample(out_sample->hall, 0, 0, 0, false, true);
    return calibration_pressure_is_optional() ? ESP_OK : pressure_err;
  }

  pressure_err = calibration_validate_pressure_triplet(
      out_sample->p0, out_sample->p1, out_sample->p2);
  out_sample->pressure_valid = pressure_err == ESP_OK;
  calibration_record_progress_sample(out_sample->hall, out_sample->p0,
                                     out_sample->p1, out_sample->p2,
                                     out_sample->pressure_valid, true);
  if (!out_sample->pressure_valid && !calibration_pressure_is_optional()) {
    return pressure_err;
  }

  return ESP_OK;
}

static esp_err_t
calibration_collect_hall_rest_stats(calibration_signal_stats_t *hall_stats) {
  if (hall_stats == NULL)
    return ESP_ERR_INVALID_ARG;

  calibration_stats_init(hall_stats);

  int sample_count = s_candidate_config.calibration_sample_count > 0
                         ? s_candidate_config.calibration_sample_count
                         : CALIBRATION_REST_OBSERVATIONS;
  if (sample_count < CALIBRATION_REST_OBSERVATIONS) {
    sample_count = CALIBRATION_REST_OBSERVATIONS;
  }
  if (sample_count > CALIBRATION_MAX_STATS_SAMPLES) {
    sample_count = CALIBRATION_MAX_STATS_SAMPLES;
  }

  int window_ms = s_candidate_config.calibration_window_ms > 0
                      ? s_candidate_config.calibration_window_ms
                      : 2000;
  int delay_ms = window_ms / sample_count;
  if (delay_ms < 5)
    delay_ms = 5;

  for (int valid = 0; valid < sample_count && s_running; valid++) {
    int32_t hall = 0;
    esp_err_t err = calibration_read_hall_average(&hall);
    if (err != ESP_OK) {
      return err;
    }
    calibration_stats_update(hall_stats, hall);
    if (calibration_delay_or_cancel(delay_ms) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  if (!s_running) {
    return ESP_ERR_INVALID_STATE;
  }

  calibration_stats_finalize(hall_stats);
  return ESP_OK;
}

/**
 * @brief Read HX710 safely and convert timeout into ESP error.
 */
static esp_err_t calibration_read_pressure_once(gpio_num_t sck_pin,
                                                gpio_num_t dout_pin,
                                                int32_t *out_value) {
  if (out_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }
  /* sck_pin is unused because shared SCK is used internally */
  (void)sck_pin;

  /* Use shared-SCK synchronized read and select the requested dout pin value */
  int32_t v0 = 0, v1 = 0, v2 = 0;
  esp_err_t err = hx710_read_3_shared_sck(
      BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT, BOARD_HX710_1_DOUT,
      BOARD_HX710_2_DOUT, &v0, &v1, &v2);

  if (err != ESP_OK) {
    return err;
  }

  /* Log all three raw sensor values (decimal + hex) to make stuck bit patterns
   * visible */
  ESP_LOGD(TAG, "p0=%ld hex=0x%06X p1=%ld hex=0x%06X p2=%ld hex=0x%06X",
           (long)v0, (unsigned int)((uint32_t)v0 & 0xFFFFFF), (long)v1,
           (unsigned int)((uint32_t)v1 & 0xFFFFFF), (long)v2,
           (unsigned int)((uint32_t)v2 & 0xFFFFFF));

  err = calibration_validate_pressure_triplet(v0, v1, v2);
  if (err != ESP_OK) {
    return err;
  }

  if (dout_pin == BOARD_HX710_0_DOUT) {
    *out_value = v0;
  } else if (dout_pin == BOARD_HX710_1_DOUT) {
    *out_value = v1;
  } else if (dout_pin == BOARD_HX710_2_DOUT) {
    *out_value = v2;
  } else {
    return ESP_ERR_INVALID_ARG;
  }

  return ESP_OK;
}

/**
 * @brief Read averaged HX710 value to reduce noise.
 *
 * This is still a raw value. We are only averaging several raw reads.
 */
static esp_err_t calibration_read_pressure_average(gpio_num_t sck_pin,
                                                   gpio_num_t dout_pin,
                                                   int32_t *out_value) {
  if (out_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  int64_t sum = 0;

  for (int i = 0; i < CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT; i++) {
    int32_t value = 0;

    esp_err_t err = calibration_read_pressure_once(sck_pin, dout_pin, &value);
    if (err != ESP_OK) {
      return err;
    }

    sum += value;
    if (calibration_delay_or_cancel(5) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  *out_value = (int32_t)(sum / CALIBRATION_PRESSURE_AVERAGE_SAMPLE_COUNT);

  return ESP_OK;
}

/**
 * @brief Read averaged Hall ADC value.
 *
 * Hall sensor driver only reads raw ADC.
 * Calibration manager decides how to use the raw value.
 */
static esp_err_t calibration_read_hall_average(int32_t *out_value) {
  if (out_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  int64_t sum = 0;

  for (int i = 0; i < CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT; i++) {
    int raw_value = 0;

    esp_err_t err = hall_sensor_read_raw(&s_hall_sensor, &raw_value);
    if (err != ESP_OK) {
      return err;
    }

    sum += raw_value;
    if (calibration_delay_or_cancel(5) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  *out_value = (int32_t)(sum / CALIBRATION_HALL_AVERAGE_SAMPLE_COUNT);

  return ESP_OK;
}

/**
 * @brief Wait until pressure sensor reaches the expected target range.
 */
static esp_err_t calibration_wait_for_pressure_target(
    const char *label, gpio_num_t sck_pin, gpio_num_t dout_pin,
    int32_t target_value, int32_t tolerance, int32_t *matched_value) {
  if (label == NULL || matched_value == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  const int64_t deadline_us =
      esp_timer_get_time() + ((int64_t)CALIBRATION_MAX_WAIT_MS * 1000LL);
  int consecutive_read_failures = 0;

  ESP_LOGI(TAG, "Waiting for %s target=%ld tolerance=%ld deadline_ms=%d", label,
           (long)target_value, (long)tolerance, CALIBRATION_MAX_WAIT_MS);

  while (s_running && esp_timer_get_time() < deadline_us) {
    int32_t current_value = 0;

    esp_err_t err =
        calibration_read_pressure_average(sck_pin, dout_pin, &current_value);
    if (err != ESP_OK) {
      consecutive_read_failures++;
      ESP_LOGW(TAG, "%s read failed: %s consecutive=%d", label,
               esp_err_to_name(err), consecutive_read_failures);

      /* Propagate stuck-zero detection immediately to caller; caller will
       * decide failure mapping */
      if (err == ESP_ERR_INVALID_RESPONSE ||
          (calibration_pressure_is_optional() &&
           consecutive_read_failures >=
               CALIBRATION_OPTIONAL_PRESSURE_MAX_READ_FAILURES)) {
        return err;
      }

      if (calibration_delay_or_cancel(CALIBRATION_POLL_DELAY_MS) != ESP_OK) {
        return ESP_ERR_INVALID_STATE;
      }
      continue;
    }
    consecutive_read_failures = 0;

    /* Log current selected value */
    ESP_LOGI(TAG, "%s current=%ld target=%ld", label, (long)current_value,
             (long)target_value);

    /* Also log the last raw triplet at DEBUG level so hex patterns are
     * available when needed */
    ESP_LOGD(TAG, "p0=%ld hex=0x%06X p1=%ld hex=0x%06X p2=%ld hex=0x%06X",
             (long)s_last_hx710_raw[0],
             (unsigned int)((uint32_t)s_last_hx710_raw[0] & 0xFFFFFF),
             (long)s_last_hx710_raw[1],
             (unsigned int)((uint32_t)s_last_hx710_raw[1] & 0xFFFFFF),
             (long)s_last_hx710_raw[2],
             (unsigned int)((uint32_t)s_last_hx710_raw[2] & 0xFFFFFF));

    if (calibration_is_within_tolerance(current_value, target_value,
                                        tolerance)) {
      *matched_value = current_value;

      ESP_LOGI(TAG, "%s matched with value=%ld", label, (long)current_value);

      return ESP_OK;
    }

    if (calibration_delay_or_cancel(CALIBRATION_POLL_DELAY_MS) != ESP_OK) {
      return ESP_ERR_INVALID_STATE;
    }
  }

  if (!s_running) {
    return ESP_ERR_INVALID_STATE;
  }

  ESP_LOGE(TAG, "%s target wait timeout", label);

  return ESP_ERR_TIMEOUT;
}

/**
 * @brief Mark calibration as failed and update indicator.
 */
static void calibration_manager_fail(calibration_reason_id_t reason_id) {
  s_last_failure_reason = reason_id;
  s_last_failure_action =
      calibration_codes_default_action_for_reason(reason_id);

  ESP_LOGE(TAG,
           "Calibration failed reason_id=%d reason=%s action_id=%d action=%s",
           (int)s_last_failure_reason,
           calibration_codes_reason_to_string(s_last_failure_reason),
           (int)s_last_failure_action,
           calibration_codes_action_to_string(s_last_failure_action));

  s_candidate_config.calibrated = false;

  // Clear candidate details in config store RAM/snapshot diagnostics
  config_store_set_candidate_profile(NULL, 0, NULL);

  status_indicator_set_state(RESQ_STATE_CALIBRATION_FAIL);

  publish_calibration_progress(
      s_last_failure_reason, RESQ_STATE_CALIBRATION_FAIL, s_last_failure_action,
      12); // 12 = Calibration failed
}

/**
 * @brief Mark calibration as successful, save config, and update indicator.
 */
static esp_err_t calibration_manager_save_success(void) {
  LOCK_MGR();
  if (!calibration_config_is_valid(&s_candidate_config)) {
    calibration_manager_fail(CAL_REASON_CALIBRATION_VALUES_OUT_OF_RANGE);
    UNLOCK_MGR();
    return ESP_ERR_INVALID_STATE;
  }

  calibration_store_snapshot_t snapshot;
  cal_store_outcome_t promote_outcome = config_store_promote_calibration(&s_candidate_config, &s_calibration_config, &snapshot);
  if (promote_outcome != CAL_STORE_VALID) {
    calibration_reason_id_t fail_reason;
    switch (promote_outcome) {
      case CAL_STORE_CORRUPT:                    fail_reason = CAL_REASON_CORRUPT;                    break;
      case CAL_STORE_UNSUPPORTED_SCHEMA:         fail_reason = CAL_REASON_UNSUPPORTED_SCHEMA;         break;
      case CAL_STORE_COMMIT_VERIFICATION_FAILED: fail_reason = CAL_REASON_COMMIT_VERIFICATION_FAILED; break;
      case CAL_STORE_GENERATION_EXHAUSTED:       fail_reason = CAL_REASON_GENERATION_EXHAUSTED;       break;
      case CAL_STORE_PROFILE_HASH_MISMATCH:      fail_reason = CAL_REASON_PROFILE_HASH_MISMATCH;      break;
      case CAL_STORE_IO_ERROR:                   // fall-through
      default:                                   fail_reason = CAL_REASON_IO_ERROR;                   break;
    }
    calibration_manager_fail(fail_reason);
    UNLOCK_MGR();
    return ESP_FAIL;
  }

  // Clear candidate details in config store RAM/snapshot diagnostics upon commit
  config_store_set_candidate_profile(NULL, 0, NULL);

  status_indicator_set_state(RESQ_STATE_READY_FOR_SESSION);
  UNLOCK_MGR();

  ESP_LOGI(TAG, "Calibration completed and saved successfully");

  return ESP_OK;
}

/* =========================================================
 * Main calibration task
 * ========================================================= */

/**
 * @brief Calibration state flow task.
 *
 * Flow:
 * 1. Wait until pressure sensor 0 matches ref_pressure.
 * 2. Wait until pressure sensor 1 matches bladder_1_pressure.
 * 3. Wait until pressure sensor 2 matches bladder_2_pressure.
 * 4. Capture synchronized Hall and pressure baselines while all targets hold.
 * 5. Use hall_delta to determine the requested full-compression movement.
 * 6. Wait for the Hall sensor to reach full compression.
 * 7. Capture Hall, bladder 1, and bladder 2 full-press values.
 * 8. Derive pressure differences and normalized runtime balance thresholds.
 * 9. Validate and save calibration config.
 */
static void calibration_manager_task(void *arg) {
  (void)arg;

  ESP_LOGI(TAG, "Calibration task started");

  if (s_calibration_events != NULL) {
    xEventGroupSetBits(s_calibration_events, CAL_EVENT_TASK_RUNNING);
  }

  status_indicator_set_state(RESQ_STATE_CALIBRATING);

  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_NONE,
                               1); // 1 = Calibration started

  int32_t matched_ref_pressure = 0;
  int32_t matched_bladder_1_pressure = 0;
  int32_t matched_bladder_2_pressure = 0;

  /* -----------------------------------------------------
   * Step 1: Collect an unloaded sensor-health sample before
   * asking the operator to set the three pressure targets.
   * ----------------------------------------------------- */
  calibration_signal_stats_t initial_hall_stats;
  calibration_signal_stats_t initial_p0_stats;
  calibration_signal_stats_t initial_p1_stats;
  calibration_signal_stats_t initial_p2_stats;

  ESP_LOGI(TAG,
           "Calibration health check: release chest and keep manikin still");
  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_WAIT_OR_CANCEL,
                               1); // 1 = Calibration started

  if (calibration_delay_or_cancel(2000) != ESP_OK) {
    goto task_exit;
  }

  calibration_stats_init(&initial_p0_stats);
  calibration_stats_init(&initial_p1_stats);
  calibration_stats_init(&initial_p2_stats);

  esp_err_t err = ESP_OK;
  if (s_candidate_config.pressure_mode == CALIBRATION_HALL_ONLY) {
    ESP_LOGI(TAG,
             "Hall-only calibration: skipping pressure rest health collection");
    err = calibration_collect_hall_rest_stats(&initial_hall_stats);
  } else {
    err = calibration_collect_rest_stats(&initial_hall_stats, &initial_p0_stats,
                                         &initial_p1_stats, &initial_p2_stats);
  }
  if (err != ESP_OK) {
    if (!s_running) {
      goto task_exit;
    }
    if (!calibration_pressure_is_optional()) {
      ESP_LOGE(TAG, "Failed to collect rest stats: %s", esp_err_to_name(err));
      calibration_manager_fail(CAL_REASON_SENSOR_STUCK_OR_NOISE);
      goto task_exit;
    }
    ESP_LOGW(TAG, "Pressure rest stats unavailable; continuing Hall-only: %s",
             esp_err_to_name(err));
    calibration_mark_pressure_degraded(false);
    publish_calibration_progress(
        CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
        RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 2);
    err = calibration_collect_hall_rest_stats(&initial_hall_stats);
    if (err != ESP_OK) {
      calibration_manager_fail(CAL_REASON_HALL_BASELINE_READ_FAILED);
      goto task_exit;
    }
    calibration_stats_init(&initial_p0_stats);
    calibration_stats_init(&initial_p1_stats);
    calibration_stats_init(&initial_p2_stats);
    /* Host targets are intent, not sensor observations. Keep unavailable
     * pressure samples explicit instead of fabricating measurements. */
    initial_p0_stats.mean = 0;
    initial_p1_stats.mean = 0;
    initial_p2_stats.mean = 0;
  }

  ESP_LOGI(TAG,
           "Initial stats (trimmed): hall_mean=%ld noise=%ld raw_span=%ld "
           "p0_mean=%ld noise=%ld raw_span=%ld "
           "p1_mean=%ld noise=%ld raw_span=%ld "
           "p2_mean=%ld noise=%ld raw_span=%ld",
           (long)initial_hall_stats.mean, (long)initial_hall_stats.noise_pp,
           (long)((int64_t)initial_hall_stats.max - initial_hall_stats.min),
           (long)initial_p0_stats.mean, (long)initial_p0_stats.noise_pp,
           (long)((int64_t)initial_p0_stats.max - initial_p0_stats.min),
           (long)initial_p1_stats.mean, (long)initial_p1_stats.noise_pp,
           (long)((int64_t)initial_p1_stats.max - initial_p1_stats.min),
           (long)initial_p2_stats.mean, (long)initial_p2_stats.noise_pp,
           (long)((int64_t)initial_p2_stats.max - initial_p2_stats.min));

  calibration_reason_id_t pressure_health_reason =
      s_candidate_config.pressure_mode == CALIBRATION_HALL_ONLY
          ? CAL_REASON_NONE
          : calibration_validate_pressure_rest_health(
                &initial_p0_stats, &initial_p1_stats, &initial_p2_stats);

  if (pressure_health_reason != CAL_REASON_NONE &&
      !calibration_pressure_is_optional()) {
    calibration_manager_fail(pressure_health_reason);
    goto task_exit;
  } else if (pressure_health_reason != CAL_REASON_NONE) {
    ESP_LOGW(TAG, "Pressure health degraded (%s); continuing with Hall sensor",
             calibration_codes_reason_to_string(pressure_health_reason));
    calibration_mark_pressure_degraded(false);
    publish_calibration_progress(
        CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
        RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 2);
  } else {
    calibration_update_stable_pressure(true, true, true, initial_p0_stats.mean,
                                       initial_p1_stats.mean,
                                       initial_p2_stats.mean);
  }

  /* Hall rest stability checks (direction-safe, reason-correct) */
  int32_t expected_hall_delta =
      calibration_abs_i32(s_candidate_config.hall_delta);
  if (expected_hall_delta < CALIBRATION_HALL_DELTA_MIN_RAW ||
      expected_hall_delta > CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS) {
    calibration_manager_fail(CAL_REASON_INVALID_HALL_DELTA);
    goto task_exit;
  }
  s_candidate_config.hall_valid = true;

  /* -----------------------------------------------------
   * Steps 2-4: Set P0, then P1, then P2 to their requested
   * values. These waits are intentional calibration stages.
   * ----------------------------------------------------- */
  int32_t tol0 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.ref_pressure, initial_p0_stats.noise_pp);
  int32_t tol1 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.bladder_1_pressure, initial_p1_stats.noise_pp);
  int32_t tol2 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.bladder_2_pressure, initial_p2_stats.noise_pp);

  bool run_pressure_targets =
      s_candidate_config.pressure_mode != CALIBRATION_HALL_ONLY &&
      calibration_pressure_targets_usable(&s_candidate_config) &&
      !s_candidate_config.pressure_degraded;

  if (run_pressure_targets) {
    ESP_LOGI(TAG, "Set reference pressure P0 to the requested target");
    publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_WAIT_OR_CANCEL,
                                 2); // 2 = Waiting reference pressure
    err = calibration_wait_for_pressure_target(
        "reference pressure P0", BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT,
        s_candidate_config.ref_pressure, tol0, &matched_ref_pressure);
    if (err != ESP_OK) {
      if (!s_running)
        goto task_exit;
      if (!calibration_pressure_is_optional()) {
        calibration_manager_fail(err == ESP_ERR_INVALID_RESPONSE
                                     ? CAL_REASON_SENSOR_STUCK_OR_NOISE
                                     : CAL_REASON_REF_PRESSURE_TIMEOUT);
        goto task_exit;
      }
      calibration_mark_pressure_degraded(s_pressure_snapshot.p0_stable);
      publish_calibration_progress(
          CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
          RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 2);
      matched_ref_pressure = s_pressure_snapshot.p0_stable
                                 ? s_pressure_snapshot.last_stable_p0
                                 : 0;
    } else {
      calibration_update_stable_pressure(true, false, false,
                                         matched_ref_pressure, 0, 0);
    }

    publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE,
                                 3); // 3 = Reference pressure matched

    if (!s_candidate_config.pressure_degraded) {
      ESP_LOGI(TAG, "Set bladder pressure P1 to the requested target");
      publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                   CAL_ACTION_WAIT_OR_CANCEL,
                                   4); // 4 = Waiting bladder 1 pressure
      err = calibration_wait_for_pressure_target(
          "bladder pressure P1", BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT,
          s_candidate_config.bladder_1_pressure, tol1,
          &matched_bladder_1_pressure);
      if (err != ESP_OK) {
        if (!s_running)
          goto task_exit;
        if (!calibration_pressure_is_optional()) {
          calibration_manager_fail(err == ESP_ERR_INVALID_RESPONSE
                                       ? CAL_REASON_SENSOR_STUCK_OR_NOISE
                                       : CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT);
          goto task_exit;
        }
        calibration_mark_pressure_degraded(s_pressure_snapshot.p1_stable);
        publish_calibration_progress(
            CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
            RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 4);
        matched_bladder_1_pressure = s_pressure_snapshot.p1_stable
                                         ? s_pressure_snapshot.last_stable_p1
                                         : 0;
      } else {
        calibration_update_stable_pressure(false, true, false, 0,
                                           matched_bladder_1_pressure, 0);
      }
    }

    publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE,
                                 5); // 5 = Bladder 1 pressure matched

    if (!s_candidate_config.pressure_degraded) {
      ESP_LOGI(TAG, "Set bladder pressure P2 to the requested target");
      publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                   CAL_ACTION_WAIT_OR_CANCEL,
                                   6); // 6 = Waiting bladder 2 pressure
      err = calibration_wait_for_pressure_target(
          "bladder pressure P2", BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT,
          s_candidate_config.bladder_2_pressure, tol2,
          &matched_bladder_2_pressure);
      if (err != ESP_OK) {
        if (!s_running)
          goto task_exit;
        if (!calibration_pressure_is_optional()) {
          calibration_manager_fail(err == ESP_ERR_INVALID_RESPONSE
                                       ? CAL_REASON_SENSOR_STUCK_OR_NOISE
                                       : CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT);
          goto task_exit;
        }
        calibration_mark_pressure_degraded(s_pressure_snapshot.p2_stable);
        publish_calibration_progress(
            CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
            RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 6);
        matched_bladder_2_pressure = s_pressure_snapshot.p2_stable
                                         ? s_pressure_snapshot.last_stable_p2
                                         : 0;
      } else {
        calibration_update_stable_pressure(false, false, true, 0, 0,
                                           matched_bladder_2_pressure);
      }
    }

    publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                                 CAL_ACTION_NONE,
                                 7); // 7 = Bladder 2 pressure matched
  } else {
    ESP_LOGI(
        TAG,
        "Skipping pressure target waits for pressure_mode=%s "
        "pressure_degraded=%d targets_usable=%d",
        calibration_pressure_mode_to_string(s_candidate_config.pressure_mode),
        s_candidate_config.pressure_degraded,
        calibration_pressure_targets_usable(&s_candidate_config));
    calibration_mark_pressure_degraded(s_pressure_snapshot.has_stable_pressure);
  }

  ESP_LOGI(TAG,
           "Pressure targets reached: P0=%ld P1=%ld P2=%ld; keep all pressures "
           "steady",
           (long)matched_ref_pressure, (long)matched_bladder_1_pressure,
           (long)matched_bladder_2_pressure);

  /* -----------------------------------------------------
   * Step 5: Capture synchronized baselines only after all
   * three pressure targets have been established.
   * ----------------------------------------------------- */
  calibration_signal_stats_t hall_stats;
  calibration_signal_stats_t p0_stats;
  calibration_signal_stats_t p1_stats;
  calibration_signal_stats_t p2_stats;

  if (calibration_delay_or_cancel(500) != ESP_OK) {
    goto task_exit;
  }
  if (s_candidate_config.pressure_degraded ||
      s_candidate_config.pressure_mode == CALIBRATION_HALL_ONLY) {
    err = calibration_collect_hall_rest_stats(&hall_stats);
    calibration_stats_init(&p0_stats);
    calibration_stats_init(&p1_stats);
    calibration_stats_init(&p2_stats);
    p0_stats.mean =
        s_pressure_snapshot.p0_stable ? s_pressure_snapshot.last_stable_p0 : 0;
    p1_stats.mean =
        s_pressure_snapshot.p1_stable ? s_pressure_snapshot.last_stable_p1 : 0;
    p2_stats.mean =
        s_pressure_snapshot.p2_stable ? s_pressure_snapshot.last_stable_p2 : 0;
  } else {
    err = calibration_collect_rest_stats(&hall_stats, &p0_stats, &p1_stats,
                                         &p2_stats);
  }
  if (err != ESP_OK) {
    if (!s_running)
      goto task_exit;
    if (!calibration_pressure_is_optional()) {
      calibration_manager_fail(CAL_REASON_PRESSURE_BASELINE_UNSTABLE);
      goto task_exit;
    }
    calibration_mark_pressure_degraded(s_pressure_snapshot.has_stable_pressure);
    publish_calibration_progress(
        CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE,
        RESQ_STATE_CALIBRATING, CAL_ACTION_NONE, 8);
    err = calibration_collect_hall_rest_stats(&hall_stats);
    if (err != ESP_OK) {
      calibration_manager_fail(CAL_REASON_HALL_BASELINE_READ_FAILED);
      goto task_exit;
    }
    calibration_stats_init(&p0_stats);
    calibration_stats_init(&p1_stats);
    calibration_stats_init(&p2_stats);
    p0_stats.mean = s_pressure_snapshot.p0_stable
                        ? s_pressure_snapshot.last_stable_p0
                        : matched_ref_pressure;
    p1_stats.mean = s_pressure_snapshot.p1_stable
                        ? s_pressure_snapshot.last_stable_p1
                        : matched_bladder_1_pressure;
    p2_stats.mean = s_pressure_snapshot.p2_stable
                        ? s_pressure_snapshot.last_stable_p2
                        : matched_bladder_2_pressure;
  }

  pressure_health_reason =
      (s_candidate_config.pressure_degraded ||
       s_candidate_config.pressure_mode == CALIBRATION_HALL_ONLY)
          ? CAL_REASON_NONE
          : calibration_validate_pressure_rest_health(&p0_stats, &p1_stats,
                                                      &p2_stats);
  if (pressure_health_reason != CAL_REASON_NONE &&
      !calibration_pressure_is_optional()) {
    calibration_manager_fail(pressure_health_reason);
    goto task_exit;
  } else if (pressure_health_reason != CAL_REASON_NONE) {
    calibration_mark_pressure_degraded(s_pressure_snapshot.has_stable_pressure);
  }

  tol0 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.ref_pressure, p0_stats.noise_pp);
  tol1 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.bladder_1_pressure, p1_stats.noise_pp);
  tol2 = calibration_adaptive_pressure_tolerance(
      s_candidate_config.bladder_2_pressure, p2_stats.noise_pp);

  if (!s_candidate_config.pressure_degraded &&
      s_candidate_config.pressure_mode != CALIBRATION_HALL_ONLY &&
      !calibration_is_within_tolerance(
          p0_stats.mean, s_candidate_config.ref_pressure, tol0)) {
    ESP_LOGE(TAG,
             "P0 drifted outside target during baseline capture: value=%ld "
             "target=%ld tolerance=%ld",
             (long)p0_stats.mean, (long)s_candidate_config.ref_pressure,
             (long)tol0);
    if (!calibration_pressure_is_optional()) {
      calibration_manager_fail(CAL_REASON_REF_PRESSURE_TIMEOUT);
      goto task_exit;
    }
    calibration_mark_pressure_degraded(s_pressure_snapshot.p0_stable);
  }
  if (!s_candidate_config.pressure_degraded &&
      s_candidate_config.pressure_mode != CALIBRATION_HALL_ONLY &&
      !calibration_is_within_tolerance(
          p1_stats.mean, s_candidate_config.bladder_1_pressure, tol1)) {
    ESP_LOGE(TAG,
             "P1 drifted outside target during baseline capture: value=%ld "
             "target=%ld tolerance=%ld",
             (long)p1_stats.mean, (long)s_candidate_config.bladder_1_pressure,
             (long)tol1);
    if (!calibration_pressure_is_optional()) {
      calibration_manager_fail(CAL_REASON_BLADDER_1_PRESSURE_TIMEOUT);
      goto task_exit;
    }
    calibration_mark_pressure_degraded(s_pressure_snapshot.p1_stable);
  }
  if (!s_candidate_config.pressure_degraded &&
      s_candidate_config.pressure_mode != CALIBRATION_HALL_ONLY &&
      !calibration_is_within_tolerance(
          p2_stats.mean, s_candidate_config.bladder_2_pressure, tol2)) {
    ESP_LOGE(TAG,
             "P2 drifted outside target during baseline capture: value=%ld "
             "target=%ld tolerance=%ld",
             (long)p2_stats.mean, (long)s_candidate_config.bladder_2_pressure,
             (long)tol2);
    if (!calibration_pressure_is_optional()) {
      calibration_manager_fail(CAL_REASON_BLADDER_2_PRESSURE_TIMEOUT);
      goto task_exit;
    }
    calibration_mark_pressure_degraded(s_pressure_snapshot.p2_stable);
  }

  s_candidate_config.hall_baseline = hall_stats.mean;
  s_candidate_config.hall_noise_raw = hall_stats.noise_pp;
  s_candidate_config.pressure_0_baseline = p0_stats.mean;
  s_candidate_config.pressure_1_baseline = p1_stats.mean;
  s_candidate_config.pressure_2_baseline = p2_stats.mean;
  s_candidate_config.pressure_0_noise_raw = p0_stats.noise_pp;
  s_candidate_config.pressure_1_noise_raw = p1_stats.noise_pp;
  s_candidate_config.pressure_2_noise_raw = p2_stats.noise_pp;

  ESP_LOGI(TAG, "Calibrated baselines: hall=%ld P0=%ld P1=%ld P2=%ld",
           (long)s_candidate_config.hall_baseline,
           (long)s_candidate_config.pressure_0_baseline,
           (long)s_candidate_config.pressure_1_baseline,
           (long)s_candidate_config.pressure_2_baseline);

  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_NONE,
                               8); // 8 = Hall baseline captured

  if ((int64_t)s_candidate_config.hall_noise_raw * 5 >=
      (int64_t)expected_hall_delta) {
    calibration_manager_fail(CAL_REASON_HALL_NOISE_TOO_HIGH);
    goto task_exit;
  }

  /* -----------------------------------------------------
   * Steps 6-8: Capture full compression and derive the Hall
   * range plus each bladder's pressure difference.
   * ----------------------------------------------------- */
  int32_t matched_hall_full = 0;
  int32_t matched_b1_full = 0;
  int32_t matched_b2_full = 0;
  calibration_reason_id_t hall_failure_reason = CAL_REASON_NONE;

  /* Publish progress and prompt operator before waiting for full press */
  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_WAIT_OR_CANCEL,
                               9); // 9 = Waiting full press
  ESP_LOGI(TAG, "Waiting for Hall full press: ask operator to press and hold "
                "full compression now");

  err = calibration_collect_full_press_stats(
      s_candidate_config.hall_delta, &matched_hall_full, &matched_b1_full,
      &matched_b2_full, &hall_stats, &hall_failure_reason);

  if (err != ESP_OK) {
    if (hall_failure_reason != CAL_REASON_NONE) {
      calibration_manager_fail(hall_failure_reason);
    } else if (err == ESP_ERR_INVALID_ARG) {
      calibration_manager_fail(CAL_REASON_INVALID_HALL_DELTA);
    } else if (err == ESP_ERR_TIMEOUT) {
      calibration_manager_fail(CAL_REASON_HALL_FULL_PRESS_TIMEOUT);
    } else {
      calibration_manager_fail(CAL_REASON_FULL_PRESS_PRESSURE_READ_FAILED);
    }
    goto task_exit;
  }

  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_NONE,
                               10); // 10 = Full press captured

  ESP_LOGI(TAG, "Captured full-press: hall=%ld b1=%ld b2=%ld",
           (long)matched_hall_full, (long)matched_b1_full,
           (long)matched_b2_full);

  /* Derive adaptive thresholds and store in s_candidate_config */
  calibration_derive_adaptive_thresholds(&hall_stats, &p0_stats, &p1_stats,
                                         &p2_stats, matched_hall_full,
                                         matched_b1_full, matched_b2_full);

  /* Validate derived adaptive thresholds and fail with a specific reason if
   * invalid */
  calibration_reason_id_t vreason = calibration_validate_derived_thresholds();
  if (vreason != CAL_REASON_NONE) {
    calibration_manager_fail(vreason);
    goto task_exit;
  }

  /* Final save */
  s_candidate_config.calibrated = true;

  err = calibration_manager_save_success();
  if (err != ESP_OK) {
    goto task_exit;
  }

  publish_calibration_progress(CAL_REASON_NONE, RESQ_STATE_CALIBRATING,
                               CAL_ACTION_NONE,
                               11); // 11 = Calibration saved

task_exit:
  ESP_LOGI(TAG, "Calibration task ended");

  s_running = false;
  s_calibration_task_handle = NULL;
  sensor_owner_release(SENSOR_OWNER_CALIBRATION);
  if (s_calibration_events != NULL) {
    xEventGroupSetBits(s_calibration_events, CAL_EVENT_TASK_DONE);
  }

  vTaskDelete(NULL);
}

/* =========================================================
 * Public API implementation
 * ========================================================= */

esp_err_t calibration_manager_init(void) {
  if (s_initialized) {
    return ESP_OK;
  }

  calibration_config_set_defaults(&s_candidate_config);

  esp_err_t owner_err = sensor_owner_init();
  if (owner_err != ESP_OK) {
    return owner_err;
  }

  if (s_calibration_events == NULL) {
    s_calibration_events = xEventGroupCreate();
    if (s_calibration_events == NULL) {
      return ESP_ERR_NO_MEM;
    }
  }

  /* Initialize pressure sensor 0 (shared SCK) */
  esp_err_t err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_0_DOUT);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to init pressure sensor 0: %s", esp_err_to_name(err));
    return err;
  }

  /* Initialize pressure sensor 1 (shared SCK) */
  err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_1_DOUT);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to init pressure sensor 1: %s", esp_err_to_name(err));
    return err;
  }

  /* Initialize pressure sensor 2 (shared SCK) */
  err = hx710_init(BOARD_HX710_SHARED_SCK, BOARD_HX710_2_DOUT);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to init pressure sensor 2: %s", esp_err_to_name(err));
    return err;
  }

  /* Initialize Hall sensor raw ADC driver */
  err = hall_sensor_init(&s_hall_sensor, BOARD_HALL_ADC_CHAN);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Failed to init Hall sensor: %s", esp_err_to_name(err));
    return err;
  }

  if (s_manager_mutex == NULL) {
    s_manager_mutex = xSemaphoreCreateMutex();
  }

  calibration_config_set_defaults(&s_candidate_config);

  /*
   * Try loading previously saved calibration.
   * If not found, config remains default and calibrated=false.
   */
  err = config_store_load_calibration(&s_calibration_config);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Failed to load saved calibration: %s", esp_err_to_name(err));
    calibration_config_set_defaults(&s_calibration_config);
  }

  s_initialized = true;
  s_running = false;

  ESP_LOGI(TAG, "Calibration manager initialized");

  return ESP_OK;
}

esp_err_t calibration_manager_start(const network_config_t *network_config,
                                    const calibration_config_t *host_params,
                                    const char *command_id) {

  if (s_manager_mutex == NULL) {
    s_manager_mutex = xSemaphoreCreateMutex();
  }

  if (!s_initialized) {
    return ESP_ERR_INVALID_STATE;
  }

  if (network_config == NULL || host_params == NULL || command_id == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  LOCK_MGR();
  if (s_running || s_calibration_task_handle != NULL || s_session_reservation.reserved) {
    UNLOCK_MGR();
    return ESP_ERR_INVALID_STATE;
  }

  /* Hall delta validation */
  if (host_params->hall_delta < CALIBRATION_HALL_DELTA_MIN_RAW ||
      host_params->hall_delta > CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS ||
      (calibration_pressure_targets_required(host_params->pressure_mode) &&
       !calibration_pressure_targets_usable(host_params))) {

    ESP_LOGE(TAG, "Invalid host calibration parameters");
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }

  /* Validate profile ID rules: 1-31 characters, case-sensitive alphanumeric and dashes/underscores, no whitespace */
  size_t id_len = strlen(host_params->profile_id);
  if (id_len == 0 || id_len > 31) {
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }
  for (size_t i = 0; i < id_len; i++) {
    char c = host_params->profile_id[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) {
      UNLOCK_MGR();
      return ESP_ERR_INVALID_ARG;
    }
  }

  /* Validate profile Hash rules: 64 hex characters, lowercase */
  size_t hash_len = strlen(host_params->profile_hash);
  if (hash_len != 64) {
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }
  bool is_zero_hash = true;
  for (size_t i = 0; i < 64; i++) {
    char c = host_params->profile_hash[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
      UNLOCK_MGR();
      return ESP_ERR_INVALID_ARG;
    }
    if (c != '0') {
      is_zero_hash = false;
    }
  }
  if (is_zero_hash) {
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }

  esp_err_t owner_err = sensor_owner_acquire(SENSOR_OWNER_CALIBRATION);
  if (owner_err != ESP_OK) {
    UNLOCK_MGR();
    return owner_err;
  }

  /* Compute and verify SHA-256 fingerprint */
  char computed_hash[65];
  if (calculate_fingerprint(
          host_params->profile_id, host_params->profile_version,
          host_params->hall_delta, host_params->ref_pressure,
          host_params->bladder_1_pressure, host_params->bladder_2_pressure,
          computed_hash, sizeof(computed_hash)) != ESP_OK ||
      strcmp(computed_hash, host_params->profile_hash) != 0) {
    ESP_LOGE(TAG, "Firmware hash mismatch: expected %s, got %s", host_params->profile_hash, computed_hash);
    sensor_owner_release(SENSOR_OWNER_CALIBRATION);
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }

  /* Set candidate profile details in config store RAM */
  config_store_set_candidate_profile(host_params->profile_id, host_params->profile_version, host_params->profile_hash);

  /* Set recalibration required marker in NVS */
  esp_err_t recal_err = config_store_mark_recalibration_required();
  if (recal_err != ESP_OK) {
    sensor_owner_release(SENSOR_OWNER_CALIBRATION);
    UNLOCK_MGR();
    return recal_err;
  }

  /* Start from firmware defaults, then copy only host-controlled fields to s_candidate_config. */
  calibration_config_set_defaults(&s_candidate_config);

  s_candidate_config.ref_pressure = host_params->ref_pressure;
  s_candidate_config.bladder_1_pressure = host_params->bladder_1_pressure;
  s_candidate_config.bladder_2_pressure = host_params->bladder_2_pressure;
  s_candidate_config.hall_delta = host_params->hall_delta;
  if (host_params->full_depth_mm > 0.0f) {
    s_candidate_config.full_depth_mm = host_params->full_depth_mm;
  }
  if (host_params->pressure_0_kpa_per_count > 0.0f) {
    s_candidate_config.pressure_0_kpa_per_count =
        host_params->pressure_0_kpa_per_count;
  }
  if (host_params->pressure_1_kpa_per_count > 0.0f) {
    s_candidate_config.pressure_1_kpa_per_count =
        host_params->pressure_1_kpa_per_count;
  }
  if (host_params->pressure_2_kpa_per_count > 0.0f) {
    s_candidate_config.pressure_2_kpa_per_count =
        host_params->pressure_2_kpa_per_count;
  }
  s_candidate_config.pressure_mode = host_params->pressure_mode;
  if (s_candidate_config.pressure_mode < CALIBRATION_PRESSURE_REQUIRED ||
      s_candidate_config.pressure_mode > CALIBRATION_HALL_ONLY) {
    sensor_owner_release(SENSOR_OWNER_CALIBRATION);
    UNLOCK_MGR();
    return ESP_ERR_INVALID_ARG;
  }
  s_candidate_config.pressure_degraded = false;
  s_candidate_config.using_last_stable_pressure = false;
  s_candidate_config.pressure_valid = true;
  s_candidate_config.hall_valid = false;

  if (host_params->profile_id[0] != '\0') {
    strncpy(s_candidate_config.profile_id, host_params->profile_id,
            sizeof(s_candidate_config.profile_id) - 1);
    s_candidate_config
        .profile_id[sizeof(s_candidate_config.profile_id) - 1] = '\0';
  }
  s_candidate_config.profile_version = host_params->profile_version;
  strncpy(s_candidate_config.profile_hash, host_params->profile_hash,
          sizeof(s_candidate_config.profile_hash) - 1);
  s_candidate_config.profile_hash[sizeof(s_candidate_config.profile_hash) - 1] = '\0';
  if (host_params->pressure_balance_allowed_pct >= 5 &&
      host_params->pressure_balance_allowed_pct <= 60) {
    s_candidate_config.pressure_balance_allowed_pct =
        host_params->pressure_balance_allowed_pct;
  }
  if (host_params->calibration_sample_count > 0) {
    s_candidate_config.calibration_sample_count = calibration_min_i32(
        host_params->calibration_sample_count, CALIBRATION_MAX_STATS_SAMPLES);
  }
  if (host_params->calibration_window_ms > 0) {
    s_candidate_config.calibration_window_ms =
        host_params->calibration_window_ms;
  }

  /* save host params so BUTTON_1 retry can reuse them */
  memcpy(&s_last_host_params, host_params, sizeof(s_last_host_params));
  s_has_last_host_params = true;
  s_last_failure_reason = CAL_REASON_NONE;
  s_last_failure_action = CAL_ACTION_NONE;

  /* copy network config and command id into static state for progress publishing */
  memcpy(&s_network_config, network_config, sizeof(network_config_t));
  strncpy(s_command_id, command_id, sizeof(s_command_id) - 1);
  s_command_id[sizeof(s_command_id) - 1] = '\0';

  /* Reset diagnostic arrays for this calibration run */
  memset(s_hx710_zero_streaks, 0, sizeof(s_hx710_zero_streaks));
  memset(s_last_hx710_raw, 0, sizeof(s_last_hx710_raw));
  memset(&s_pressure_snapshot, 0, sizeof(s_pressure_snapshot));
  memset(&s_last_calibration_raw_sample, 0,
         sizeof(s_last_calibration_raw_sample));
  s_has_last_calibration_raw_sample = false;
  s_last_calibration_pressure_valid = false;
  s_last_calibration_hall_valid = false;

  /* Debug: log the received host calibration payload values */
  ESP_LOGI(TAG,
           "Calibration payload: hall_delta=%ld ref_pressure=%ld bladder_1=%ld "
           "bladder_2=%ld balance_pct=%d",
           (long)s_candidate_config.hall_delta,
           (long)s_candidate_config.ref_pressure,
           (long)s_candidate_config.bladder_1_pressure,
           (long)s_candidate_config.bladder_2_pressure,
           s_candidate_config.pressure_balance_allowed_pct);

  s_running = true;
  if (s_calibration_events != NULL) {
    xEventGroupClearBits(s_calibration_events, CAL_EVENT_TASK_RUNNING |
                                                   CAL_EVENT_TASK_DONE |
                                                   CAL_EVENT_CANCEL_REQ);
  }

  BaseType_t task_result =
      xTaskCreate(calibration_manager_task, "calibration_manager",
                  CALIBRATION_TASK_STACK_SIZE, NULL, CALIBRATION_TASK_PRIORITY,
                  &s_calibration_task_handle);

  if (task_result != pdPASS) {
    s_running = false;
    s_calibration_task_handle = NULL;
    sensor_owner_release(SENSOR_OWNER_CALIBRATION);
    UNLOCK_MGR();
    return ESP_FAIL;
  }

  EventBits_t bits = xEventGroupWaitBits(
      s_calibration_events, CAL_EVENT_TASK_RUNNING | CAL_EVENT_TASK_DONE,
      pdFALSE, pdFALSE, pdMS_TO_TICKS(1000));
  if ((bits & CAL_EVENT_TASK_RUNNING) == 0) {
    ESP_LOGE(TAG, "Calibration task did not enter running state");
    s_running = false;
    xTaskNotifyGive(s_calibration_task_handle);
    (void)xEventGroupWaitBits(s_calibration_events, CAL_EVENT_TASK_DONE,
                              pdFALSE, pdFALSE,
                              pdMS_TO_TICKS(CALIBRATION_CANCEL_WAIT_MS));
    UNLOCK_MGR();
    return ESP_ERR_TIMEOUT;
  }

  ESP_LOGI(TAG, "Calibration started");

  UNLOCK_MGR();
  return ESP_OK;
}

esp_err_t calibration_manager_cancel(void) {
  if (s_manager_mutex == NULL) {
    s_manager_mutex = xSemaphoreCreateMutex();
  }
  LOCK_MGR();
  if (!s_running && s_calibration_task_handle == NULL) {
    UNLOCK_MGR();
    return ESP_OK;
  }

  ESP_LOGW(TAG, "Calibration cancel requested");

  if (s_calibration_events != NULL) {
    xEventGroupSetBits(s_calibration_events, CAL_EVENT_CANCEL_REQ);
  }
  s_running = false;
  if (s_calibration_task_handle != NULL) {
    xTaskNotifyGive(s_calibration_task_handle);
  }

  s_candidate_config.calibrated = false;
  UNLOCK_MGR();

  if (s_calibration_events != NULL) {
    EventBits_t bits =
        xEventGroupWaitBits(s_calibration_events, CAL_EVENT_TASK_DONE, pdFALSE,
                            pdFALSE, pdMS_TO_TICKS(CALIBRATION_CANCEL_WAIT_MS));
    if ((bits & CAL_EVENT_TASK_DONE) == 0) {
      ESP_LOGE(TAG, "Timed out waiting for calibration cleanup");
      config_store_set_candidate_profile(NULL, 0, NULL);
      return ESP_ERR_TIMEOUT;
    }
  } else {
    while (s_calibration_task_handle != NULL) {
      vTaskDelay(pdMS_TO_TICKS(10));
    }
  }

  // Clear candidate profile fields
  config_store_set_candidate_profile(NULL, 0, NULL);

  status_indicator_set_state(RESQ_STATE_PAIRED_IDLE);

  return ESP_OK;
}

bool calibration_manager_is_running(void) {
  LOCK_MGR();
  bool running = s_running || (s_calibration_task_handle != NULL);
  UNLOCK_MGR();
  return running;
}

bool calibration_manager_is_ready(void) {
  LOCK_MGR();
  bool ready = s_calibration_config.calibrated;
  UNLOCK_MGR();
  return ready;
}

esp_err_t calibration_manager_get_config(calibration_config_t *out_config) {
  if (out_config == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  LOCK_MGR();
  memcpy(out_config, &s_calibration_config, sizeof(calibration_config_t));
  UNLOCK_MGR();

  return ESP_OK;
}

const char *calibration_manager_get_command_id(void) { return s_command_id; }

calibration_reason_id_t calibration_manager_get_last_failure_reason(void) {
  return s_last_failure_reason;
}

calibration_action_id_t calibration_manager_get_last_failure_action(void) {
  return s_last_failure_action;
}

esp_err_t
calibration_manager_get_last_host_params(calibration_config_t *out_config) {
  if (out_config == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!s_has_last_host_params) {
    return ESP_ERR_NOT_FOUND;
  }

  memcpy(out_config, &s_last_host_params, sizeof(calibration_config_t));
  return ESP_OK;
}

esp_err_t calibration_manager_drop_temporary_values(void) {
  LOCK_MGR();
  esp_err_t err = config_store_load_calibration(&s_calibration_config);
  if (err != ESP_OK) {
    calibration_config_set_defaults(&s_calibration_config);
  }
  calibration_config_set_defaults(&s_candidate_config);
  config_store_set_candidate_profile(NULL, 0, NULL);
  UNLOCK_MGR();

  return ESP_OK;
}

esp_err_t calibration_manager_retry_last(network_config_t *network_config) {
  if (network_config == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!s_has_last_host_params) {
    return ESP_ERR_NOT_FOUND;
  }

  if (s_running || s_calibration_task_handle != NULL) {
    return ESP_ERR_INVALID_STATE;
  }

  const char *cmd_id = s_command_id[0] ? s_command_id : "button/retry";

  return calibration_manager_start(network_config, &s_last_host_params, cmd_id);
}

esp_err_t calibration_manager_publish_progress_event(
    calibration_reason_id_t reason_id, resq_state_t state,
    calibration_action_id_t action_id, int progress_id) {
  publish_calibration_progress(reason_id, state, action_id, progress_id);
  return ESP_OK;
}

esp_err_t calibration_manager_parse_start_payload(
    const char *payload, calibration_config_t *out_config, char *out_command_id,
    size_t out_command_id_len, calibration_reason_id_t *out_reason) {
  if (out_reason != NULL) {
    *out_reason = CAL_REASON_NONE;
  }

  if (payload == NULL || out_config == NULL) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
    }
    return ESP_ERR_INVALID_ARG;
  }

  calibration_config_t candidate;
  calibration_config_set_defaults(&candidate);

  if (out_command_id != NULL && out_command_id_len > 0) {
    out_command_id[0] = '\0';
  }

  cJSON *root = cJSON_Parse(payload);
  if (root == NULL) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
    }
    return ESP_FAIL;
  }

  esp_err_t result = ESP_OK;

  /* Prefer request_id, fall back to command_id for compatibility */
  cJSON *command_id = cJSON_GetObjectItemCaseSensitive(root, "request_id");
  if (!cJSON_IsString(command_id) || command_id->valuestring == NULL) {
    command_id = cJSON_GetObjectItemCaseSensitive(root, "command_id");
  }
  cJSON *hall_delta = cJSON_GetObjectItemCaseSensitive(root, "hall_delta");
  cJSON *hall_delta_sum =
      cJSON_GetObjectItemCaseSensitive(root, "hall_delta_sum");
  cJSON *hall_delta_sample_count =
      cJSON_GetObjectItemCaseSensitive(root, "hall_delta_sample_count");
  cJSON *ref_pressure = cJSON_GetObjectItemCaseSensitive(root, "ref_pressure");
  cJSON *bladder_1_pressure =
      cJSON_GetObjectItemCaseSensitive(root, "bladder_1_pressure");
  cJSON *bladder_2_pressure =
      cJSON_GetObjectItemCaseSensitive(root, "bladder_2_pressure");
  cJSON *profile_id = cJSON_GetObjectItemCaseSensitive(root, "profile_id");
  cJSON *pressure_balance_allowed_pct =
      cJSON_GetObjectItemCaseSensitive(root, "pressure_balance_allowed_pct");
  cJSON *full_depth_mm =
      cJSON_GetObjectItemCaseSensitive(root, "full_depth_mm");
  cJSON *pressure_0_kpa_per_count =
      cJSON_GetObjectItemCaseSensitive(root, "pressure_0_kpa_per_count");
  cJSON *pressure_1_kpa_per_count =
      cJSON_GetObjectItemCaseSensitive(root, "pressure_1_kpa_per_count");
  cJSON *pressure_2_kpa_per_count =
      cJSON_GetObjectItemCaseSensitive(root, "pressure_2_kpa_per_count");
  cJSON *pressure_mode =
      cJSON_GetObjectItemCaseSensitive(root, "pressure_mode");
  cJSON *calibration_sample_count =
      cJSON_GetObjectItemCaseSensitive(root, "calibration_sample_count");
  cJSON *calibration_window_ms =
      cJSON_GetObjectItemCaseSensitive(root, "calibration_window_ms");
  cJSON *profile_version = cJSON_GetObjectItemCaseSensitive(root, "profile_version");
  cJSON *profile_hash = cJSON_GetObjectItemCaseSensitive(root, "profile_hash");

  calibration_pressure_mode_t parsed_pressure_mode =
      CALIBRATION_PRESSURE_OPTIONAL;
  if (!calibration_pressure_mode_parse(pressure_mode, &parsed_pressure_mode)) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
    }
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  /* Require an identifier and exactly one Hall-delta representation. */
  bool has_hall_delta = cJSON_IsNumber(hall_delta);
  bool has_hall_delta_sum = cJSON_IsNumber(hall_delta_sum);

  if (!json_identifier_valid(command_id, sizeof(s_command_id)) ||
      has_hall_delta == has_hall_delta_sum) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
    }
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  cJSON *hall_delta_source = has_hall_delta_sum ? hall_delta_sum : hall_delta;
  bool hall_delta_is_sum = has_hall_delta_sum;
  int32_t hall_delta_sample_count_value = 0;
  if (hall_delta_is_sum) {
    if (!json_number_to_i32(hall_delta_sample_count, 1,
                            CALIBRATION_MAX_STATS_SAMPLES,
                            &hall_delta_sample_count_value)) {
      if (out_reason != NULL) {
        *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
      }
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
  } else if (hall_delta->valuedouble >
             (double)CALIBRATION_HALL_DELTA_MAX_ADC_COUNTS) {
    if (!json_number_to_i32(hall_delta_sample_count, 1,
                            CALIBRATION_MAX_STATS_SAMPLES,
                            &hall_delta_sample_count_value)) {
      if (out_reason != NULL) {
        *out_reason = CAL_REASON_INVALID_HALL_DELTA;
      }
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
    hall_delta_is_sum = true;
  }

  int32_t hall_delta_input = 0;
  int32_t hall_delta_adc_counts = 0;
  if (!json_number_to_i32(hall_delta_source, INT32_MIN, INT32_MAX,
                          &hall_delta_input) ||
      calibration_convert_host_hall_delta(
          hall_delta_input, hall_delta_sample_count_value, hall_delta_is_sum,
          &hall_delta_adc_counts) != ESP_OK) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_HALL_DELTA;
    }
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  bool pressure_targets_required =
      calibration_pressure_targets_required(parsed_pressure_mode);
  bool any_pressure_target = ref_pressure != NULL || bladder_1_pressure != NULL ||
                             bladder_2_pressure != NULL;
  bool pressure_targets_present = cJSON_IsNumber(ref_pressure) &&
                                  cJSON_IsNumber(bladder_1_pressure) &&
                                  cJSON_IsNumber(bladder_2_pressure);
  int32_t ref_pressure_value = 0;
  int32_t bladder_1_pressure_value = 0;
  int32_t bladder_2_pressure_value = 0;

  if ((pressure_targets_required && !pressure_targets_present) ||
      (any_pressure_target && !pressure_targets_present) ||
      (pressure_targets_present &&
       (!json_number_to_i32(ref_pressure, 1, INT32_MAX,
                            &ref_pressure_value) ||
        !json_number_to_i32(bladder_1_pressure, 1, INT32_MAX,
                            &bladder_1_pressure_value) ||
        !json_number_to_i32(bladder_2_pressure, 1, INT32_MAX,
                            &bladder_2_pressure_value)))) {
    if (out_reason != NULL) {
      *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
    }
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }

  candidate.hall_delta = hall_delta_adc_counts;
  candidate.pressure_mode = parsed_pressure_mode;
  if (pressure_targets_present) {
    candidate.ref_pressure = ref_pressure_value;
    candidate.bladder_1_pressure = bladder_1_pressure_value;
    candidate.bladder_2_pressure = bladder_2_pressure_value;
  }
  candidate.calibrated = false;

  if (profile_id != NULL) {
    if (!json_identifier_valid(profile_id, sizeof(candidate.profile_id))) {
      if (out_reason != NULL) {
        *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
      }
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
    strncpy(candidate.profile_id, profile_id->valuestring,
            sizeof(candidate.profile_id) - 1);
    candidate.profile_id[sizeof(candidate.profile_id) - 1] = '\0';
  }

  if (cJSON_IsNumber(profile_version)) {
    candidate.profile_version = profile_version->valueint;
  }
  if (cJSON_IsString(profile_hash) && profile_hash->valuestring != NULL) {
    strncpy(candidate.profile_hash, profile_hash->valuestring,
            sizeof(candidate.profile_hash) - 1);
    candidate.profile_hash[sizeof(candidate.profile_hash) - 1] = '\0';
  }

  if (pressure_balance_allowed_pct != NULL) {
    int32_t pct = 0;
    if (!json_number_to_i32(pressure_balance_allowed_pct, 5, 60, &pct)) {
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
    candidate.pressure_balance_allowed_pct = pct;
  }

  if (full_depth_mm != NULL &&
      !json_number_to_positive_float(full_depth_mm, 500.0f,
                                     &candidate.full_depth_mm)) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }
  if (pressure_0_kpa_per_count != NULL &&
      !json_number_to_positive_float(pressure_0_kpa_per_count, 1000.0f,
                                     &candidate.pressure_0_kpa_per_count)) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }
  if (pressure_1_kpa_per_count != NULL &&
      !json_number_to_positive_float(pressure_1_kpa_per_count, 1000.0f,
                                     &candidate.pressure_1_kpa_per_count)) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }
  if (pressure_2_kpa_per_count != NULL &&
      !json_number_to_positive_float(pressure_2_kpa_per_count, 1000.0f,
                                     &candidate.pressure_2_kpa_per_count)) {
    result = ESP_ERR_INVALID_ARG;
    goto exit;
  }
  if (calibration_sample_count != NULL) {
    int32_t value = 0;
    if (!json_number_to_i32(calibration_sample_count, 1,
                            CALIBRATION_MAX_STATS_SAMPLES, &value)) {
      if (out_reason != NULL) {
        *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
      }
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
    candidate.calibration_sample_count = value;
  }
  if (calibration_window_ms != NULL) {
    int32_t value = 0;
    if (!json_number_to_i32(calibration_window_ms, 1,
                            CALIBRATION_MAX_WAIT_MS, &value)) {
      if (out_reason != NULL) {
        *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
      }
      result = ESP_ERR_INVALID_ARG;
      goto exit;
    }
    candidate.calibration_window_ms = value;
  }

exit:
  if (result == ESP_OK) {
    memcpy(out_config, &candidate, sizeof(candidate));
    if (out_command_id != NULL && out_command_id_len > 0) {
      strncpy(out_command_id, command_id->valuestring, out_command_id_len - 1);
      out_command_id[out_command_id_len - 1] = '\0';
    }
  } else if (out_reason != NULL && *out_reason == CAL_REASON_NONE) {
    *out_reason = CAL_REASON_INVALID_CALIBRATION_PAYLOAD;
  }
  cJSON_Delete(root);
  return result;
}

static esp_err_t calculate_fingerprint(
    const char *profile_id, uint32_t profile_version,
    int32_t hall_delta, int32_t ref_pressure,
    int32_t bladder_1_pressure, int32_t bladder_2_pressure,
    char *out_hex, size_t out_hex_len
) {
    if (profile_id == NULL || out_hex == NULL || out_hex_len < 65) {
        return ESP_ERR_INVALID_ARG;
    }

    char buffer[256];
    int written = snprintf(
        buffer, sizeof(buffer),
        "profile_id=%s;profile_version=%lu;hall_delta=%ld;ref_pressure=%ld;bladder_1_pressure=%ld;bladder_2_pressure=%ld",
        profile_id, (unsigned long)profile_version, (long)hall_delta, (long)ref_pressure,
        (long)bladder_1_pressure, (long)bladder_2_pressure
    );

    if (written < 0 || written >= (int)sizeof(buffer)) {
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t digest[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    int ret = mbedtls_sha256_starts(&ctx, 0);
    if (ret != 0) {
        mbedtls_sha256_free(&ctx);
        return ESP_FAIL;
    }
    ret = mbedtls_sha256_update(&ctx, (const unsigned char *)buffer, written);
    if (ret != 0) {
        mbedtls_sha256_free(&ctx);
        return ESP_FAIL;
    }
    ret = mbedtls_sha256_finish(&ctx, digest);
    mbedtls_sha256_free(&ctx);
    if (ret != 0) {
        return ESP_FAIL;
    }

    for (int i = 0; i < 32; i++) {
        sprintf(out_hex + (i * 2), "%02x", digest[i]);
    }
    out_hex[64] = '\0';

    return ESP_OK;
}

esp_err_t calibration_manager_publish_calibration_result(
    const char *reply_id, const char *status, const char *result,
    calibration_reason_id_t reason_id, resq_state_t state,
    calibration_action_id_t action_id) {
  if (reply_id == NULL || reply_id[0] == '\0') {
    return ESP_ERR_INVALID_ARG;
  }

  const char *result_to_publish = result != NULL ? result : "";
  calibration_reason_id_t reason_to_publish = reason_id;
  if (strcmp(result_to_publish, "PASS") == 0 &&
      s_candidate_config.pressure_degraded) {
    result_to_publish = "PASS_WITH_WARNINGS";
    reason_to_publish = CAL_REASON_PRESSURE_SENSOR_SATURATED_USING_LAST_STABLE;
  }

  int event_id = 4000;
  if (strcmp(result_to_publish, "PASS") == 0 ||
      strcmp(result_to_publish, "PASS_WITH_WARNINGS") == 0 ||
      strcmp(result_to_publish, "FAIL") == 0 ||
      strcmp(result_to_publish, "CANCELLED") == 0) {
    event_id = 4002;
  }
  int progress_id = calibration_result_progress_id(result_to_publish);
  bool accepted_result = strcmp(result_to_publish, "PASS") == 0 ||
                         strcmp(result_to_publish, "PASS_WITH_WARNINGS") == 0;

  float hall_full_press_mm = 0.0f;
  float hall_full_press_progress = 0.0f;
  int32_t hall_full_press_delta_raw = 0;
  sensor_raw_sample_t hall_full_press_raw = {
      .hall_raw = s_candidate_config.hall_full_press,
      .hall_read_valid = true,
  };
  sensor_conversion_profile_t hall_full_press_profile =
      calibration_conversion_profile(&s_candidate_config);
  sensor_converted_sample_t hall_full_press_converted = {0};
  bool converted_full_press =
      sensor_conversion_convert(&hall_full_press_raw, &hall_full_press_profile,
                                &hall_full_press_converted) == ESP_OK;
  bool pressure_kpa_valid =
      accepted_result && s_candidate_config.pressure_valid &&
      !s_candidate_config.pressure_degraded && converted_full_press &&
      hall_full_press_converted.pressure_profile_valid;
  bool hall_mm_valid = accepted_result && s_candidate_config.hall_valid &&
                       converted_full_press &&
                       hall_full_press_converted.hall_profile_valid;
  bool hall_full_press_sample_valid =
      converted_full_press && hall_full_press_converted.hall_mm_valid;
  if (hall_full_press_sample_valid) {
    hall_full_press_mm = hall_full_press_converted.hall_mm;
    hall_full_press_progress = hall_full_press_converted.hall_progress;
    hall_full_press_delta_raw = hall_full_press_converted.hall_delta_raw;
  }

  calibration_store_snapshot_t snapshot;
  memset(&snapshot, 0, sizeof(snapshot));
  snprintf(snapshot.calibration_storage_status, CALIBRATION_STORAGE_STATUS_MAX_LEN, "%s", "UNKNOWN");
  snapshot.recalibration_required = 1;
  cal_store_outcome_t snap_result = config_store_get_snapshot(&snapshot);
  // Only publish PASS if the committed snapshot is actually valid
  if (snap_result != CAL_STORE_VALID && (
      strcmp(result_to_publish, "PASS") == 0 ||
      strcmp(result_to_publish, "PASS_WITH_WARNINGS") == 0)) {
    result_to_publish = "FAIL";
  }

  char payload[1792];
  if (strcmp(result_to_publish, "PASS") == 0 ||
      strcmp(result_to_publish, "PASS_WITH_WARNINGS") == 0) {
    int written = snprintf(
        payload, sizeof(payload),
        "{"
        "\"event_id\":%d,"
        "\"reply_id\":\"%s\","
        "\"device_id\":\"%s\","
        "\"status\":\"%s\","
        "\"result\":\"%s\","
        "\"progress_id\":%d,"
        "\"reason_id\":\"%s\","
        "\"state\":\"%s\","
        "\"action_id\":%d,"
        "\"calibrated\":true,"
        "\"ready_for_session\":true,"
        "\"pressure_mode\":\"%s\","
        "\"pressure_degraded\":%s,"
        "\"using_last_stable_pressure\":%s,"
        "\"pressure_valid\":%s,"
        "\"hall_valid\":%s,"
        "\"pressure_kpa_valid\":%s,"
        "\"hall_mm_valid\":%s,"
        "\"full_depth_mm\":%.3f,"
        "\"hall_baseline\":%d,"
        "\"hall_baseline_raw\":%d,"
        "\"hall_full_press\":%d,"
        "\"hall_full_press_raw\":%d,"
        "\"hall_full_press_mm\":%.3f,"
        "\"hall_full_press_progress\":%.3f,"
        "\"hall_full_press_delta_raw\":%d,"
        "\"hall_range_raw\":%d,"
        "\"hall_start_delta\":%d,"
        "\"hall_full_delta_threshold\":%d,"
        "\"hall_recoil_delta\":%d,"
        "\"pressure_0_baseline_raw\":%d,"
        "\"pressure_1_baseline_raw\":%d,"
        "\"pressure_2_baseline_raw\":%d,"
        "\"pressure_0_kpa_per_count\":%.9f,"
        "\"pressure_1_kpa_per_count\":%.9f,"
        "\"pressure_2_kpa_per_count\":%.9f,"
        "\"pressure_1_range_raw\":%d,"
        "\"pressure_2_range_raw\":%d,"
        "\"pressure_contact_threshold\":%d,"
        "\"pressure_valid_threshold\":%d,"
        "\"pressure_balance_allowed_pct\":%d,"
        "\"ts_ms\":%lld,"
        "\"calibration_storage_status\":\"%s\","
        "\"calibration_schema_version\":%d,"
        "\"calibration_generation\":%d,"
        "\"profile_id\":\"%s\","
        "\"profile_version\":%d,"
        "\"profile_hash\":\"%s\","
        "\"recalibration_required\":%s"
        "}",
        event_id, reply_id, runtime_helpers_get_device_id(&s_network_config),
        status != NULL ? status : "", result_to_publish, progress_id,
        calibration_reason_contract_id(reason_to_publish),
        resq_state_to_string(state), (int)action_id,
        calibration_pressure_mode_to_string(s_candidate_config.pressure_mode),
        s_candidate_config.pressure_degraded ? "true" : "false",
        s_candidate_config.using_last_stable_pressure ? "true" : "false",
        s_candidate_config.pressure_valid ? "true" : "false",
        s_candidate_config.hall_valid ? "true" : "false",
        pressure_kpa_valid ? "true" : "false", hall_mm_valid ? "true" : "false",
        s_candidate_config.full_depth_mm,
        (int)s_candidate_config.hall_baseline,
        (int)s_candidate_config.hall_baseline,
        (int)s_candidate_config.hall_full_press,
        (int)s_candidate_config.hall_full_press,
        hall_full_press_sample_valid ? hall_full_press_mm : 0.0f,
        hall_full_press_sample_valid ? hall_full_press_progress : 0.0f,
        hall_full_press_sample_valid ? (int)hall_full_press_delta_raw : 0,
        (int)s_candidate_config.hall_range_raw,
        (int)s_candidate_config.hall_start_delta,
        (int)s_candidate_config.hall_full_delta_threshold,
        (int)s_candidate_config.hall_recoil_delta,
        (int)s_candidate_config.pressure_0_baseline,
        (int)s_candidate_config.pressure_1_baseline,
        (int)s_candidate_config.pressure_2_baseline,
        s_candidate_config.pressure_0_kpa_per_count,
        s_candidate_config.pressure_1_kpa_per_count,
        s_candidate_config.pressure_2_kpa_per_count,
        (int)s_candidate_config.pressure_1_range_raw,
        (int)s_candidate_config.pressure_2_range_raw,
        (int)s_candidate_config.pressure_contact_threshold,
        (int)s_candidate_config.pressure_valid_threshold,
        (int)s_candidate_config.pressure_balance_allowed_pct,
        (long long)(esp_timer_get_time() / 1000),
        snapshot.calibration_storage_status,
        (int)snapshot.schema_version,
        (int)snapshot.generation,
        snapshot.profile_id,
        (int)snapshot.profile_version,
        snapshot.profile_hash,
        snapshot.recalibration_required == 1 ? "true" : "false");

    if (written <= 0 || written >= (int)sizeof(payload)) {
      return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
      return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION,
                                           payload);
  } else {
    int written = 0;
    if (event_id == 4002) {
      written = snprintf(
          payload, sizeof(payload),
          "{"
          "\"event_id\":%d,"
          "\"reply_id\":\"%s\","
          "\"device_id\":\"%s\","
          "\"status\":\"%s\","
          "\"result\":\"%s\","
          "\"progress_id\":%d,"
          "\"reason_id\":\"%s\","
          "\"state\":\"%s\","
          "\"action_id\":%d,"
          "\"pressure_mode\":\"%s\","
          "\"pressure_degraded\":%s,"
          "\"using_last_stable_pressure\":%s,"
          "\"pressure_valid\":%s,"
          "\"hall_valid\":%s,"
          "\"pressure_kpa_valid\":%s,"
          "\"hall_mm_valid\":%s,"
          "\"full_depth_mm\":%.3f,"
          "\"ts_ms\":%lld,"
          "\"calibration_storage_status\":\"%s\","
          "\"calibration_schema_version\":%d,"
          "\"calibration_generation\":%d,"
          "\"profile_id\":\"%s\","
          "\"profile_version\":%d,"
          "\"profile_hash\":\"%s\","
          "\"recalibration_required\":%s"
          "}",
          event_id, reply_id, runtime_helpers_get_device_id(&s_network_config),
          status != NULL ? status : "", result_to_publish, progress_id,
          calibration_reason_contract_id(reason_to_publish),
          resq_state_to_string(state), (int)action_id,
          calibration_pressure_mode_to_string(s_candidate_config.pressure_mode),
          s_candidate_config.pressure_degraded ? "true" : "false",
          s_candidate_config.using_last_stable_pressure ? "true" : "false",
          s_candidate_config.pressure_valid ? "true" : "false",
          s_candidate_config.hall_valid ? "true" : "false",
          pressure_kpa_valid ? "true" : "false", hall_mm_valid ? "true" : "false",
          s_candidate_config.full_depth_mm,
          (long long)(esp_timer_get_time() / 1000),
          snapshot.calibration_storage_status,
          (int)snapshot.schema_version,
          (int)snapshot.generation,
          snapshot.profile_id,
          (int)snapshot.profile_version,
          snapshot.profile_hash,
          snapshot.recalibration_required == 1 ? "true" : "false");
    } else {
      written = snprintf(
          payload, sizeof(payload),
          "{"
          "\"event_id\":%d,"
          "\"reply_id\":\"%s\","
          "\"device_id\":\"%s\","
          "\"status\":\"%s\","
          "\"result\":\"%s\","
          "\"progress_id\":%d,"
          "\"reason_id\":\"%s\","
          "\"state\":\"%s\","
          "\"action_id\":%d,"
          "\"pressure_mode\":\"%s\","
          "\"pressure_degraded\":%s,"
          "\"using_last_stable_pressure\":%s,"
          "\"pressure_valid\":%s,"
          "\"hall_valid\":%s,"
          "\"pressure_kpa_valid\":%s,"
          "\"hall_mm_valid\":%s,"
          "\"full_depth_mm\":%.3f,"
          "\"ts_ms\":%lld"
          "}",
          event_id, reply_id, runtime_helpers_get_device_id(&s_network_config),
          status != NULL ? status : "", result_to_publish, progress_id,
          calibration_reason_contract_id(reason_to_publish),
          resq_state_to_string(state), (int)action_id,
          calibration_pressure_mode_to_string(s_candidate_config.pressure_mode),
          s_candidate_config.pressure_degraded ? "true" : "false",
          s_candidate_config.using_last_stable_pressure ? "true" : "false",
          s_candidate_config.pressure_valid ? "true" : "false",
          s_candidate_config.hall_valid ? "true" : "false",
          pressure_kpa_valid ? "true" : "false", hall_mm_valid ? "true" : "false",
          s_candidate_config.full_depth_mm,
          (long long)(esp_timer_get_time() / 1000));
    }

    if (written <= 0 || written >= (int)sizeof(payload)) {
      return ESP_ERR_INVALID_SIZE;
    }

    if (!mqtt_manager_is_connected()) {
      return ESP_ERR_INVALID_STATE;
    }

    return mqtt_manager_publish_topic_json(RESQ_SUFFIX_EVENTS_CALIBRATION,
                                           payload);
  }
}

/* Validate pressure sensors at rest and return a meaningful calibration reason
 * on failure */
static calibration_reason_id_t calibration_validate_pressure_rest_health(
    const calibration_signal_stats_t *p0, const calibration_signal_stats_t *p1,
    const calibration_signal_stats_t *p2) {
  if (!p0 || !p1 || !p2) {
    return CAL_REASON_SENSOR_STUCK_OR_NOISE;
  }

  /* Full-scale or near full-scale readings usually mean saturation or floating
   * DOUT */
  if (calibration_is_saturated_24bit(p0->mean) ||
      calibration_is_saturated_24bit(p1->mean) ||
      calibration_is_saturated_24bit(p2->mean)) {
    return CAL_REASON_PRESSURE_SENSOR_SATURATED;
  }

  /*
   * Pressure noise is validated against the measured full-press range later.
   * Raw-unit limits here are sensor-specific and previously caused a single
   * transient sample to reject an otherwise stable calibration.
   */
  return CAL_REASON_NONE;
}

bool calibration_manager_try_reserve_session_start(const char *profile_id, uint32_t profile_version, const char *profile_hash) {
  if (profile_id == NULL || profile_hash == NULL) {
    return false;
  }
  if (s_manager_mutex == NULL) {
    s_manager_mutex = xSemaphoreCreateMutex();
  }
  LOCK_MGR();
  if (s_running || s_calibration_task_handle != NULL || s_session_reservation.reserved) {
    UNLOCK_MGR();
    return false;
  }
  s_session_reservation.reserved = true;
  strncpy(s_session_reservation.profile_id, profile_id, sizeof(s_session_reservation.profile_id) - 1);
  s_session_reservation.profile_id[sizeof(s_session_reservation.profile_id) - 1] = '\0';
  s_session_reservation.profile_version = profile_version;
  strncpy(s_session_reservation.profile_hash, profile_hash, sizeof(s_session_reservation.profile_hash) - 1);
  s_session_reservation.profile_hash[sizeof(s_session_reservation.profile_hash) - 1] = '\0';
  UNLOCK_MGR();
  return true;
}

void calibration_manager_release_session_reservation(void) {
  if (s_manager_mutex == NULL) {
    s_manager_mutex = xSemaphoreCreateMutex();
  }
  LOCK_MGR();
  s_session_reservation.reserved = false;
  memset(&s_session_reservation, 0, sizeof(s_session_reservation));
  UNLOCK_MGR();
}

