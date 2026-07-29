#include <string.h>

#include "cJSON.h"
#include "firmware_mqtt_contract.h"
#include "unity.h"

static resq_status_contract_t status_fixture(resq_state_t state) {
  resq_status_contract_t status = {
      .state = state,
      .session_active = false,
      .calibrated = true,
      .calibration_schema_version = 3,
      .calibration_generation = 7,
      .recalibration_required = false,
      .profile_version = 1,
      .state_seq = 208,
      .ts_ms = 373044,
  };
  strcpy(status.calibration_storage_status, "VALID");
  strcpy(status.profile_id, "adult-basic");
  strcpy(status.profile_hash,
         "a82453dd6c8100d280a5b711dceca20b8df17fe45ec7dfc6fbfd0d2ad257068f");
  strcpy(status.last_error_id, "00000");
  strcpy(status.boot_id, "51ee328114907a52");
  return status;
}

TEST_CASE("status contract carries restart-safe calibration identity",
          "[mqtt-contract][status]") {
  resq_status_contract_t status =
      status_fixture(RESQ_STATE_READY_FOR_SESSION);
  char *payload = NULL;
  TEST_ASSERT_EQUAL(ESP_OK,
                    resq_mqtt_contract_build_status(&status, &payload));

  cJSON *root = cJSON_Parse(payload);
  TEST_ASSERT_NOT_NULL(root);
  TEST_ASSERT_EQUAL(14, cJSON_GetArraySize(root));
  TEST_ASSERT_EQUAL_STRING(
      "READY_FOR_SESSION",
      cJSON_GetObjectItemCaseSensitive(root, "state")->valuestring);
  TEST_ASSERT_FALSE(cJSON_IsTrue(
      cJSON_GetObjectItemCaseSensitive(root, "session_active")));
  TEST_ASSERT_TRUE(
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root, "calibrated")));
  TEST_ASSERT_EQUAL_INT(
      3,
      cJSON_GetObjectItemCaseSensitive(root, "calibration_schema_version")
          ->valueint);
  TEST_ASSERT_EQUAL_INT(
      7,
      cJSON_GetObjectItemCaseSensitive(root, "calibration_generation")
          ->valueint);
  TEST_ASSERT_EQUAL_STRING(
      "VALID",
      cJSON_GetObjectItemCaseSensitive(root, "calibration_storage_status")
          ->valuestring);
  TEST_ASSERT_FALSE(cJSON_IsTrue(
      cJSON_GetObjectItemCaseSensitive(root, "recalibration_required")));
  TEST_ASSERT_EQUAL_STRING(
      "adult-basic",
      cJSON_GetObjectItemCaseSensitive(root, "profile_id")->valuestring);
  TEST_ASSERT_EQUAL_INT(
      1,
      cJSON_GetObjectItemCaseSensitive(root, "profile_version")->valueint);
  TEST_ASSERT_EQUAL_STRING(
      "a82453dd6c8100d280a5b711dceca20b8df17fe45ec7dfc6fbfd0d2ad257068f",
      cJSON_GetObjectItemCaseSensitive(root, "profile_hash")->valuestring);
  TEST_ASSERT_EQUAL_STRING(
      "00000",
      cJSON_GetObjectItemCaseSensitive(root, "last_error_id")->valuestring);
  TEST_ASSERT_EQUAL_STRING(
      "51ee328114907a52",
      cJSON_GetObjectItemCaseSensitive(root, "boot_id")->valuestring);
  TEST_ASSERT_EQUAL_UINT32(
      208,
      cJSON_GetObjectItemCaseSensitive(root, "state_seq")->valueint);
  TEST_ASSERT_EQUAL_INT64(
      373044,
      (int64_t)cJSON_GetObjectItemCaseSensitive(root, "ts_ms")->valuedouble);

  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "device_id"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "deviceId"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "ip"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "pressure_mode"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "wifi_connected"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "mqtt_connected"));

  cJSON_Delete(root);
  cJSON_free(payload);
}

TEST_CASE("uncalibrated status omits calibration identity",
          "[mqtt-contract][status]") {
  resq_status_contract_t status = status_fixture(RESQ_STATE_PAIRED_IDLE);
  status.calibrated = false;
  memset(status.calibration_storage_status, 0,
         sizeof(status.calibration_storage_status));
  memset(status.profile_id, 0, sizeof(status.profile_id));
  memset(status.profile_hash, 0, sizeof(status.profile_hash));
  status.calibration_schema_version = 0;
  status.calibration_generation = 0;
  status.profile_version = 0;

  char *payload = NULL;
  TEST_ASSERT_EQUAL(ESP_OK,
                    resq_mqtt_contract_build_status(&status, &payload));
  cJSON *root = cJSON_Parse(payload);
  TEST_ASSERT_NOT_NULL(root);
  TEST_ASSERT_EQUAL(7, cJSON_GetArraySize(root));
  TEST_ASSERT_FALSE(
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(root, "calibrated")));
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(root, "calibration_schema_version"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "profile_hash"));
  cJSON_Delete(root);
  cJSON_free(payload);
}

TEST_CASE("status session ID is conditional", "[mqtt-contract][status]") {
  resq_status_contract_t idle =
      status_fixture(RESQ_STATE_READY_FOR_SESSION);
  resq_status_contract_t active =
      status_fixture(RESQ_STATE_SESSION_ACTIVE);
  active.session_active = true;
  strcpy(active.session_id, "S-001");
  active.state_seq++;

  char *idle_payload = NULL;
  char *active_payload = NULL;
  TEST_ASSERT_EQUAL(
      ESP_OK, resq_mqtt_contract_build_status(&idle, &idle_payload));
  TEST_ASSERT_EQUAL(
      ESP_OK, resq_mqtt_contract_build_status(&active, &active_payload));
  cJSON *idle_root = cJSON_Parse(idle_payload);
  cJSON *active_root = cJSON_Parse(active_payload);
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(idle_root, "session_id"));
  TEST_ASSERT_EQUAL_STRING(
      "S-001",
      cJSON_GetObjectItemCaseSensitive(active_root, "session_id")->valuestring);
  cJSON_Delete(idle_root);
  cJSON_Delete(active_root);
  cJSON_free(idle_payload);
  cJSON_free(active_payload);
}

TEST_CASE("status equivalence ignores only firmware timestamp",
          "[mqtt-contract][status][dedup]") {
  resq_status_contract_t first =
      status_fixture(RESQ_STATE_READY_FOR_SESSION);
  resq_status_contract_t candidate = first;
  candidate.ts_ms += 5000;
  TEST_ASSERT_TRUE(
      resq_mqtt_contract_status_equivalent(&first, &candidate));

  candidate.state = RESQ_STATE_SESSION_ACTIVE;
  TEST_ASSERT_FALSE(
      resq_mqtt_contract_status_equivalent(&first, &candidate));
  candidate = first;
  candidate.state_seq++;
  TEST_ASSERT_FALSE(
      resq_mqtt_contract_status_equivalent(&first, &candidate));
  candidate = first;
  strcpy(candidate.boot_id, "61ee328114907a52");
  TEST_ASSERT_FALSE(
      resq_mqtt_contract_status_equivalent(&first, &candidate));
  candidate = first;
  candidate.calibration_generation++;
  TEST_ASSERT_FALSE(
      resq_mqtt_contract_status_equivalent(&first, &candidate));
}

TEST_CASE("all major visible states change effective status",
          "[mqtt-contract][status][transitions]") {
  const resq_state_t states[] = {
      RESQ_STATE_BOOT,
      RESQ_STATE_PAIRED_IDLE,
      RESQ_STATE_READY_FOR_SESSION,
      RESQ_STATE_CALIBRATING,
      RESQ_STATE_CALIBRATION_FAIL,
      RESQ_STATE_SESSION_ACTIVE,
      RESQ_STATE_SESSION_INTERRUPTED,
      RESQ_STATE_ERROR,
      RESQ_STATE_RESETTING,
      RESQ_STATE_TURN_OFF,
  };
  resq_status_contract_t previous = status_fixture(states[0]);
  for (size_t i = 1; i < sizeof(states) / sizeof(states[0]); ++i) {
    resq_status_contract_t next = previous;
    next.state = states[i];
    next.state_seq++;
    TEST_ASSERT_FALSE(
        resq_mqtt_contract_status_equivalent(&previous, &next));
    previous = next;
  }
}

TEST_CASE("status transport policy remains qos one and retained",
          "[mqtt-contract][status]") {
  TEST_ASSERT_EQUAL(1, RESQ_STATUS_QOS);
  TEST_ASSERT_TRUE(RESQ_STATUS_RETAIN);
}

TEST_CASE("heartbeat contract contains only minimal liveness fields",
          "[mqtt-contract][heartbeat]") {
  resq_heartbeat_contract_t heartbeat = {
      .state = RESQ_STATE_READY_FOR_SESSION,
      .session_active = false,
      .sensor_running = false,
      .calibrated = true,
      .uptime_ms = 373044,
      .ts_ms = 373044,
  };
  char *payload = NULL;
  TEST_ASSERT_EQUAL(
      ESP_OK, resq_mqtt_contract_build_heartbeat(&heartbeat, &payload));
  cJSON *root = cJSON_Parse(payload);
  TEST_ASSERT_NOT_NULL(root);
  TEST_ASSERT_EQUAL(6, cJSON_GetArraySize(root));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "device_id"));
  TEST_ASSERT_NULL(cJSON_GetObjectItemCaseSensitive(root, "ip"));
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(root, "wifi_connected"));
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(root, "mqtt_connected"));
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(root, "backend_registered"));
  TEST_ASSERT_NULL(
      cJSON_GetObjectItemCaseSensitive(root, "pressure_valid"));
  TEST_ASSERT_EQUAL_INT64(
      373044,
      (int64_t)cJSON_GetObjectItemCaseSensitive(root, "uptime_ms")->valuedouble);
  TEST_ASSERT_EQUAL_INT64(
      373044,
      (int64_t)cJSON_GetObjectItemCaseSensitive(root, "ts_ms")->valuedouble);
  cJSON_Delete(root);
  cJSON_free(payload);
}

TEST_CASE("heartbeat cadence has one five-second source of truth",
          "[mqtt-contract][heartbeat][cadence]") {
  TEST_ASSERT_EQUAL_UINT32(5000, RESQ_HEARTBEAT_INTERVAL_MS);
  TEST_ASSERT_EQUAL_UINT32(
      15000,
      resq_mqtt_contract_next_heartbeat_deadline(10000, 12000, 5000));
  TEST_ASSERT_EQUAL_UINT32(
      25000,
      resq_mqtt_contract_next_heartbeat_deadline(10000, 22000, 5000));
  TEST_ASSERT_EQUAL_UINT32(
      27000,
      resq_mqtt_contract_next_heartbeat_deadline(0, 22000, 5000));
}
