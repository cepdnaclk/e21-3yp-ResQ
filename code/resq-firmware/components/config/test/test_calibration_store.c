#include "config_store.h"

#include <string.h>

#include "calibration_fingerprint.h"
#include "nvs.h"
#include "unity.h"

#define TEST_RESQ_NVS_NAMESPACE "resq_cfg"
#define TEST_CAL_META_KEY "cal_meta"
#define TEST_CAL_SLOT_0_KEY "cal_slot_0"
#define TEST_CAL_SLOT_1_KEY "cal_slot_1"
#define TEST_CAL_SLOT_BYTES 280u
#define TEST_CAL_SCHEMA_OFFSET 4u
#define TEST_CAL_PAYLOAD_OFFSET 128u
#define TEST_CAL_RESERVED_FLAGS_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 124u)
#define TEST_CAL_POLICY_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 120u)
#define TEST_CAL_PRESSURE_1_RANGE_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 100u)
#define TEST_CAL_PRESSURE_2_RANGE_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 104u)
#define TEST_CAL_PRESSURE_CONTACT_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 108u)
#define TEST_CAL_PRESSURE_VALID_OFFSET (TEST_CAL_PAYLOAD_OFFSET + 112u)
#define TEST_CAL_CRC_OFFSET 272u

static uint32_t test_crc32(const uint8_t *data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; ++i) {
    crc ^= data[i];
    for (int bit = 0; bit < 8; ++bit) {
      crc = (crc & 1u) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
    }
  }
  return ~crc;
}

static calibration_config_t valid_profile(void) {
  calibration_config_t profile = {0};
  calibration_config_set_defaults(&profile);
  profile.hall_baseline = 10000;
  profile.hall_delta = 2000;
  profile.hall_full_press = 8000;
  profile.hall_range_raw = 2000;
  profile.hall_direction = -1;
  profile.hall_start_delta = 300;
  profile.hall_full_delta_threshold = 1500;
  profile.hall_recoil_delta = 150;
  profile.ref_pressure = 10000;
  profile.bladder_1_pressure = 10000;
  profile.bladder_2_pressure = 10000;
  profile.bladder_1_full_press = 14000;
  profile.bladder_2_full_press = 14000;
  profile.pressure_1_range_raw = 4000;
  profile.pressure_2_range_raw = 4000;
  profile.pressure_contact_threshold = 300;
  profile.pressure_valid_threshold = 1000;
  profile.pressure_balance_allowed_pct = 25;
  profile.pressure_policy = CALIBRATION_PRESSURE_OPTIONAL;
  profile.full_depth_mm = 50.0f;
  profile.calibrated_at_ms = 1000;
  profile.calibrated = true;
  profile.profile_version = 1;
  strcpy(profile.profile_id, "adult");
  TEST_ASSERT_EQUAL(
      ESP_OK, calibration_fingerprint_calculate(
                  profile.profile_id, profile.profile_version,
                  profile.hall_delta, profile.ref_pressure,
                  profile.bladder_1_pressure, profile.bladder_2_pressure,
                  profile.profile_hash, sizeof(profile.profile_hash)));
  return profile;
}

static calibration_config_t promote_profile(
    const calibration_config_t *candidate) {
  TEST_ASSERT_EQUAL(ESP_OK, config_store_init());
  TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_calibration());

  calibration_config_t committed = {0};
  calibration_store_snapshot_t snapshot = {0};
  TEST_ASSERT_EQUAL(CAL_STORE_VALID,
                    config_store_promote_calibration(
                        candidate, &committed, &snapshot));
  TEST_ASSERT_EQUAL_UINT32(2, snapshot.schema_version);
  return committed;
}

TEST_CASE("Failed candidate preserves the previous trusted calibration",
          "[config][calibration]") {
  calibration_config_t original = valid_profile();
  calibration_config_t committed = promote_profile(&original);
  calibration_config_t invalid = original;
  invalid.hall_range_raw = 0;
  calibration_store_snapshot_t snapshot = {0};

  TEST_ASSERT_EQUAL(
      CAL_STORE_CORRUPT,
      config_store_promote_calibration(&invalid, &committed, &snapshot));

  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_TRUE(loaded.calibrated);
  TEST_ASSERT_FALSE(loaded.recalibration_required);
  TEST_ASSERT_EQUAL_STRING(original.profile_hash, loaded.profile_hash);
  TEST_ASSERT_EQUAL_INT32(original.hall_range_raw, loaded.hall_range_raw);
}

static void store_i32(uint8_t *slot, size_t offset, int32_t value) {
  memcpy(&slot[offset], &value, sizeof(value));
}

static void rewrite_active_slot_as_v1(int32_t policy,
                                      bool usable_pressure) {
  nvs_handle_t handle;
  TEST_ASSERT_EQUAL(ESP_OK, nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READWRITE,
                                    &handle));
  uint8_t meta[20] = {0};
  size_t meta_len = sizeof(meta);
  TEST_ASSERT_EQUAL(ESP_OK, nvs_get_blob(handle, TEST_CAL_META_KEY, meta,
                                        &meta_len));
  uint8_t active_slot = meta[8];
  const char *slot_key =
      active_slot == 0 ? TEST_CAL_SLOT_0_KEY : TEST_CAL_SLOT_1_KEY;
  uint8_t slot[TEST_CAL_SLOT_BYTES] = {0};
  size_t slot_len = sizeof(slot);
  TEST_ASSERT_EQUAL(ESP_OK,
                    nvs_get_blob(handle, slot_key, slot, &slot_len));

  uint32_t schema = 1;
  memcpy(&slot[TEST_CAL_SCHEMA_OFFSET], &schema, sizeof(schema));
  store_i32(slot, TEST_CAL_POLICY_OFFSET, policy);
  slot[TEST_CAL_RESERVED_FLAGS_OFFSET + 0] = 1;
  slot[TEST_CAL_RESERVED_FLAGS_OFFSET + 1] = 1;
  slot[TEST_CAL_RESERVED_FLAGS_OFFSET + 2] = 0;
  slot[TEST_CAL_RESERVED_FLAGS_OFFSET + 3] = 1;
  if (!usable_pressure) {
    store_i32(slot, TEST_CAL_PRESSURE_1_RANGE_OFFSET, 0);
    store_i32(slot, TEST_CAL_PRESSURE_2_RANGE_OFFSET, 0);
    store_i32(slot, TEST_CAL_PRESSURE_CONTACT_OFFSET, 0);
    store_i32(slot, TEST_CAL_PRESSURE_VALID_OFFSET, 0);
  }
  uint32_t crc = test_crc32(slot, TEST_CAL_CRC_OFFSET);
  memcpy(&slot[TEST_CAL_CRC_OFFSET], &crc, sizeof(crc));
  TEST_ASSERT_EQUAL(ESP_OK,
                    nvs_set_blob(handle, slot_key, slot, sizeof(slot)));
  TEST_ASSERT_EQUAL(ESP_OK, nvs_commit(handle));
  nvs_close(handle);
}

TEST_CASE("Version 2 calibration roundtrip excludes runtime health",
          "[config][calibration]") {
  calibration_config_t candidate = valid_profile();
  calibration_config_t committed = promote_profile(&candidate);
  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_EQUAL_UINT32(2, loaded.calibration_schema_version);
  TEST_ASSERT_EQUAL_STRING(committed.profile_id, loaded.profile_id);
  TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, loaded.pressure_policy);
  TEST_ASSERT_EQUAL_INT32(candidate.hall_baseline, loaded.hall_baseline);
  TEST_ASSERT_EQUAL_INT32(candidate.pressure_1_range_raw,
                         loaded.pressure_1_range_raw);
}

TEST_CASE("Runtime pressure degradation is never persisted",
          "[config][calibration]") {
  calibration_config_t candidate = valid_profile();
  (void)promote_profile(&candidate);

  nvs_handle_t handle;
  TEST_ASSERT_EQUAL(ESP_OK, nvs_open(TEST_RESQ_NVS_NAMESPACE, NVS_READONLY,
                                    &handle));
  uint8_t meta[20] = {0};
  size_t meta_len = sizeof(meta);
  TEST_ASSERT_EQUAL(ESP_OK, nvs_get_blob(handle, TEST_CAL_META_KEY, meta,
                                        &meta_len));
  TEST_ASSERT_EQUAL_UINT(sizeof(meta), meta_len);
  uint8_t active_slot = meta[8];
  const char *slot_key =
      active_slot == 0 ? TEST_CAL_SLOT_0_KEY : TEST_CAL_SLOT_1_KEY;
  uint8_t slot[TEST_CAL_SLOT_BYTES] = {0};
  size_t slot_len = sizeof(slot);
  TEST_ASSERT_EQUAL(ESP_OK,
                    nvs_get_blob(handle, slot_key, slot, &slot_len));
  nvs_close(handle);

  TEST_ASSERT_EQUAL_UINT(sizeof(slot), slot_len);
  uint32_t schema = 0;
  memcpy(&schema, &slot[TEST_CAL_SCHEMA_OFFSET], sizeof(schema));
  TEST_ASSERT_EQUAL_UINT32(2, schema);
  for (size_t i = 0; i < 4; ++i) {
    TEST_ASSERT_EQUAL_HEX8(0, slot[TEST_CAL_RESERVED_FLAGS_OFFSET + i]);
  }
}

TEST_CASE("New calibration promotion rejects legacy runtime mode",
          "[config][calibration]") {
  calibration_config_t candidate = valid_profile();
  candidate.pressure_policy =
      CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE_LEGACY;
  TEST_ASSERT_EQUAL(ESP_OK, config_store_init());
  TEST_ASSERT_EQUAL(ESP_OK, config_store_clear_calibration());
  TEST_ASSERT_EQUAL(ESP_OK, config_store_mark_recalibration_required());
  calibration_config_t committed = {0};
  calibration_store_snapshot_t snapshot = {0};
  TEST_ASSERT_EQUAL(CAL_STORE_CORRUPT,
                    config_store_promote_calibration(
                        &candidate, &committed, &snapshot));
}

TEST_CASE("Version 1 required policy migrates unchanged",
          "[config][migration]") {
  calibration_config_t candidate = valid_profile();
  (void)promote_profile(&candidate);
  rewrite_active_slot_as_v1(CALIBRATION_PRESSURE_REQUIRED, true);
  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_REQUIRED, loaded.pressure_policy);
  TEST_ASSERT_EQUAL_UINT32(2, loaded.calibration_schema_version);
}

TEST_CASE("Version 1 optional policy migrates unchanged",
          "[config][migration]") {
  calibration_config_t candidate = valid_profile();
  (void)promote_profile(&candidate);
  rewrite_active_slot_as_v1(CALIBRATION_PRESSURE_OPTIONAL, true);
  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, loaded.pressure_policy);
  TEST_ASSERT_EQUAL_UINT32(2, loaded.calibration_schema_version);
}

TEST_CASE("Version 1 legacy fallback with pressure data migrates to optional",
          "[config][migration]") {
  calibration_config_t candidate = valid_profile();
  (void)promote_profile(&candidate);
  rewrite_active_slot_as_v1(
      CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE_LEGACY, true);
  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_EQUAL(CALIBRATION_PRESSURE_OPTIONAL, loaded.pressure_policy);
  TEST_ASSERT_EQUAL_UINT32(2, loaded.calibration_schema_version);
}

TEST_CASE("Version 1 legacy fallback without pressure data migrates to Hall-only",
          "[config][migration]") {
  calibration_config_t candidate = valid_profile();
  (void)promote_profile(&candidate);
  rewrite_active_slot_as_v1(
      CALIBRATION_HALL_WITH_LAST_STABLE_PRESSURE_LEGACY, false);
  calibration_config_t loaded = {0};
  TEST_ASSERT_EQUAL(ESP_OK, config_store_load_calibration(&loaded));
  TEST_ASSERT_EQUAL(CALIBRATION_HALL_ONLY, loaded.pressure_policy);
  TEST_ASSERT_EQUAL_UINT32(2, loaded.calibration_schema_version);
}
