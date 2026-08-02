"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  COMMAND_CACHE_MAX_ENTRIES,
  COMMAND_CACHE_TTL_MS,
  DEFAULTS,
  FirmwareSimulator,
  PAUSE_CONDITION_THRESHOLD_S,
  PRESSURE_CENTER_SCORE_THRESHOLD_PCT,
  normalizeSessionMetric,
} = require("./firmware-simulator.js");

const localHubRoot = path.resolve(__dirname, "../..");
const repositoryRoot = path.resolve(localHubRoot, "../..");
const fixturePath = path.join(
  localHubRoot,
  "docs",
  "telemetry-api-update",
  "fixtures",
  "minimal-mqtt-contract-fixtures.json",
);
const capturePath = path.join(
  repositoryRoot,
  "docs",
  "integration-checkup",
  "2026-07-28",
  "phase-03-active-session-120s.log",
);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function simulatorHarness() {
  const publications = [];
  const options = {
    deviceId: "M-CONTRACT",
    mqttUrl: "mqtt://unused",
    sessionId: "S-001",
    profileId: "adult-basic",
    calibrationMode: "pass",
    telemetryIntervalMs: 200,
    heartbeatIntervalMs: 5000,
    exitAfterMs: 0,
    simulateError: false,
    simulateInterrupted: false,
    quiet: true,
    bootId: "51ee328114907a52",
  };
  const simulator = new FirmwareSimulator({}, options);
  simulator.client = {
    connected: true,
    publish(topic, payload, publishOptions) {
      publications.push({
        topic,
        payload: JSON.parse(payload),
        options: publishOptions,
      });
    },
  };
  return { publications, simulator };
}

function sendCommand(simulator, command, payload) {
  simulator.handleCommand(
    simulator.topic(`cmd/${command}`),
    Buffer.from(JSON.stringify(payload), "utf8"),
  );
}

function depthFlagsConsistent(payload) {
  if (typeof payload.depth_ok !== "boolean" || typeof payload.flags !== "string") {
    return true;
  }
  const hasDepthOk = payload.flags.split(",").map((value) => value.trim()).includes("DEPTH_OK");
  return payload.depth_ok === hasDepthOk;
}

function pressureBalanceValid(payload) {
  const score = payload.pressure_balance_score_pct ?? payload.pressure_balance_pct;
  if (score === undefined) {
    return true;
  }
  if (typeof score !== "number" || score < 0 || score > 100) {
    return false;
  }
  if (
    payload.pressure_balance_score_pct !== undefined
    && payload.pressure_balance_pct !== payload.pressure_balance_score_pct
  ) {
    return false;
  }
  return payload.hand_placement !== "CENTER" || score >= PRESSURE_CENTER_SCORE_THRESHOLD_PCT;
}

test("minimal simulator-shaped session fixture follows locked metric semantics", () => {
  const payload = fixtures.minimal.sessionTelemetry;
  assert.equal(depthFlagsConsistent(payload), true);
  assert.equal(pressureBalanceValid(payload), true);
});

test("captured contradictory depth flags are detected as pending simulator non-conformance", () => {
  const payload = fixtures.invalid.contradictoryDepthFlags;
  assert.equal(depthFlagsConsistent(payload), false);

  const capturedTelemetry = fs.readFileSync(capturePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("resq/M01/telemetry "))
    .map((line) => JSON.parse(line.slice(line.indexOf(" ") + 1)));
  const contradictions = capturedTelemetry.filter((sample) => !depthFlagsConsistent(sample));
  assert.ok(contradictions.length > 0, "Phase 3 must retain evidence of the current simulator inconsistency");
});

test("pressure balance is a centeredness score and rejects invalid range", () => {
  assert.equal(pressureBalanceValid(fixtures.minimal.sessionTelemetry), true);
  assert.equal(pressureBalanceValid(fixtures.invalid.outOfRangePressureBalance), false);
});

test("simulator session telemetry is minimal and fixture-compatible", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.sessionActive = true;
  simulator.publishTelemetry();
  const metric = publications.at(-1).payload;

  assert.deepEqual(Object.keys(metric).sort(), [
    "average_completed_compression_peak_depth_mm",
    "completed_compression_count",
    "compression_count",
    "depth_mm",
    "depth_ok",
    "depth_ok_compression_count",
    "depth_progress",
    "flags",
    "hand_placement",
    "incomplete_recoil_count",
    "last_compression_peak_depth_mm",
    "pause_s",
    "pressure_balance_pct",
    "pressure_balance_score_pct",
    "rate_cpm",
    "recoil_ok",
    "recoil_ok_count",
    "session_id",
    "state",
    "ts_ms",
    "valid_compression_count",
  ]);
  assert.equal(metric.state, "SESSION_ACTIVE");
  assert.equal(metric.telemetry_mode, undefined);
  assert.equal(metric.device_id, undefined);
  assert.equal(metric.pressure_0_kpa, undefined);
  assert.equal(depthFlagsConsistent(metric), true);
  assert.equal(pressureBalanceValid(metric), true);
});

test("simulator derives flags and pressure aliases from one normalized metric", () => {
  const metric = normalizeSessionMetric({
    session_id: "S-001",
    state: "SESSION_ACTIVE",
    depth_ok: false,
    rate_cpm: 108,
    recoil_ok: false,
    pause_s: PAUSE_CONDITION_THRESHOLD_S + 0.1,
    hand_placement: "CENTER",
    pressure_balance_score_pct: 120,
    flags: "DEPTH_OK,RECOIL_OK",
  });

  assert.equal(metric.flags.includes("DEPTH_OK"), false);
  assert.equal(metric.flags.includes("RECOIL_OK"), false);
  assert.equal(metric.flags.includes("PAUSE_DETECTED"), true);
  assert.equal(metric.hand_placement, "CENTER");
  assert.equal(metric.pressure_balance_score_pct, 100);
  assert.equal(metric.pressure_balance_pct, 100);

  const skewed = normalizeSessionMetric({
    ...metric,
    hand_placement: "CENTER",
    pressure_balance_score_pct: PRESSURE_CENTER_SCORE_THRESHOLD_PCT - 0.1,
  });
  assert.equal(skewed.hand_placement, "SKEWED");
  assert.equal(skewed.flags.includes("HAND_SKEWED"), true);
});

test("session telemetry is gated and counters reset only at session start", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.startTelemetry = () => {};
  simulator.stopTelemetry = () => {};

  simulator.publishTelemetry();
  assert.equal(publications.filter((entry) => entry.topic.endsWith("/telemetry")).length, 0);

  simulator.telemetryCount = 9;
  simulator.handleSessionStart({ request_id: "start-1", session_id: "S-001" });
  assert.equal(simulator.telemetryCount, 0);
  simulator.publishTelemetry();
  simulator.publishTelemetry();
  simulator.publishTelemetry();
  assert.equal(simulator.telemetryCount, 3);
  assert.equal(simulator.latestSessionMetric.compression_count, 1);
  assert.equal(simulator.latestSessionMetric.completed_compression_count, 1);
  assert.equal(simulator.latestSessionMetric.valid_compression_count, 1);

  simulator.handleSessionStart({ request_id: "start-2", session_id: "S-002" });
  assert.equal(simulator.telemetryCount, 0);
  assert.equal(simulator.completedCompressionCount, 0);
  simulator.publishTelemetry();
  assert.equal(simulator.telemetryCount, 1);
  assert.equal(simulator.latestSessionMetric.compression_count, 0);

  simulator.handleSessionStop({ request_id: "stop-1" });
  const before = publications.filter((entry) => entry.topic.endsWith("/telemetry")).length;
  simulator.publishTelemetry();
  assert.equal(
    publications.filter((entry) => entry.topic.endsWith("/telemetry")).length,
    before,
  );
});

test("simulator completion evidence follows the configured CPR cadence", () => {
  const { simulator } = simulatorHarness();
  simulator.sessionActive = true;
  for (let index = 0; index < 300; index += 1) simulator.publishTelemetry();

  const metric = simulator.latestSessionMetric;
  assert.ok(metric.completed_compression_count >= 100 && metric.completed_compression_count <= 116);
  assert.equal(metric.compression_count, metric.completed_compression_count);
  assert.equal(metric.valid_compression_count, metric.completed_compression_count);
  assert.equal(
    metric.recoil_ok_count + metric.incomplete_recoil_count,
    metric.completed_compression_count,
  );
  assert.ok(metric.depth_ok_compression_count <= metric.completed_compression_count);
  assert.equal(typeof metric.last_compression_peak_depth_mm, "number");
  assert.equal(typeof metric.average_completed_compression_peak_depth_mm, "number");
});

test("fixture modes remain separated", () => {
  assert.equal(fixtures.minimal.sensorStream.telemetry_mode, "SENSOR_STREAM");
  assert.equal(fixtures.minimal.debugSnapshot.source, "DIRECT_SENSOR_SNAPSHOT");
  assert.equal(fixtures.minimal.debugSnapshot.reply_id, "req-debug-001");
  assert.equal(fixtures.minimal.calibrationProgress.event_id, 4001);
  assert.equal(fixtures.minimal.calibrationResult.event_id, 4002);
  assert.equal(fixtures.minimal.errorEvent.event_id, 5000);
});

test("debug traffic is one-shot correlated and absent while idle", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishHeartbeat();
  assert.equal(publications.filter((entry) => entry.topic.endsWith("/debug")).length, 0);

  simulator.handleDebug({ request_id: "debug-1" });
  const debug = publications.filter((entry) => entry.topic.endsWith("/debug"));
  assert.equal(debug.length, 1);
  assert.equal(debug[0].payload.reply_id, "debug-1");
  assert.equal(debug[0].payload.source, "DIRECT_SENSOR_SNAPSHOT");
  assert.equal(typeof debug[0].payload.ts_ms, "number");
  assert.equal(debug[0].options.retain, false);
  assert.equal(
    publications.filter(
      (entry) => entry.topic.endsWith("/events") && entry.payload.reply_id === "debug-1",
    ).length,
    1,
  );
});

test("sensor stream is explicit bounded diagnostics and does not change session counters", () => {
  const { publications, simulator } = simulatorHarness();
  const beforeCounter = simulator.telemetryCount;
  simulator.handleTelemetryControl({
    request_id: "stream-start-1",
    action: "START",
    interval_ms: 200,
  });
  const stream = publications.find(
    (entry) => entry.topic.endsWith("/telemetry")
      && entry.payload.telemetry_mode === "SENSOR_STREAM",
  );
  assert.ok(stream);
  assert.equal(stream.payload.device_id, undefined);
  assert.equal(typeof stream.payload.pressure_0_raw, "number");
  assert.equal(stream.payload.session_id, undefined);
  assert.equal(stream.payload.compression_count, undefined);
  assert.equal(simulator.telemetryCount, beforeCounter);

  simulator.handleTelemetryControl({
    request_id: "stream-stop-1",
    action: "STOP",
  });
  assert.equal(simulator.manualTelemetryTimer, null);
});

test("session and calibration transitions stop an active manual stream", () => {
  const { simulator } = simulatorHarness();
  simulator.startTelemetry = () => {};
  simulator.startManualTelemetry();
  assert.notEqual(simulator.manualTelemetryTimer, null);
  simulator.handleSessionStart({ request_id: "session-start-1", session_id: "S-001" });
  assert.equal(simulator.manualTelemetryTimer, null);

  simulator.sessionActive = false;
  simulator.state = "PAIRED_IDLE";
  simulator.startManualTelemetry();
  assert.notEqual(simulator.manualTelemetryTimer, null);
  simulator.handleCalibrationStart({ request_id: "cal-start-1" });
  assert.equal(simulator.manualTelemetryTimer, null);
  simulator.clearCalibrationTimers();
});

test("final calibration result is qos one", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishCalibrationEvent({
    event_id: 4002,
    reply_id: "cal-final-1",
    result: "PASS",
  });
  assert.equal(publications.at(-1).options.qos, 1);
});

test("duplicate commands replay correlated results without duplicate transitions", () => {
  const cases = [
    ["session/start", { session_id: "S-IDEMPOTENT" }],
    ["session/stop", {}],
    ["calibration/start", {}],
    ["calibration/cancel", {}],
    ["telemetry", { action: "START", interval_ms: 200 }],
    ["telemetry", { action: "STOP" }],
    ["debug", {}],
    ["system/retry", {}],
    ["system/reset", {}],
    ["system/flush-config", {}],
  ];

  cases.forEach(([command, extra], index) => {
    const { publications, simulator } = simulatorHarness();
    simulator.startTelemetry = () => {};
    simulator.stopTelemetry = () => {};
    simulator.startManualTelemetry = () => {
      simulator.manualTelemetryTimer = { active: true };
    };
    simulator.stopManualTelemetry = () => {
      simulator.manualTelemetryTimer = null;
    };
    const requestId = `dedup-${index}`;
    sendCommand(simulator, command, { request_id: requestId, ...extra });
    const firstResults = publications.filter(
      (entry) => entry.payload.reply_id === requestId,
    ).map((entry) => ({
      topic: entry.topic,
      payload: entry.payload,
      options: entry.options,
    }));
    const transitionCount = simulator.commandExecutionCounts.get(command);

    sendCommand(simulator, command, { request_id: requestId, ...extra });
    const allResults = publications.filter(
      (entry) => entry.payload.reply_id === requestId,
    ).map((entry) => ({
      topic: entry.topic,
      payload: entry.payload,
      options: entry.options,
    }));

    assert.equal(transitionCount, 1, `${command} must execute once`);
    assert.equal(simulator.commandExecutionCounts.get(command), 1);
    assert.ok(firstResults.length >= 1, `${command} must publish a correlated result`);
    assert.deepEqual(allResults.slice(firstResults.length), firstResults);
    simulator.clearCalibrationTimers();
  });
});

test("request IDs are scoped by command and missing IDs never execute", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.startTelemetry = () => {};
  simulator.stopTelemetry = () => {};

  sendCommand(simulator, "session/start", {
    request_id: "shared-id",
    session_id: "S-001",
  });
  sendCommand(simulator, "session/stop", { request_id: "shared-id" });
  assert.equal(simulator.commandExecutionCounts.get("session/start"), 1);
  assert.equal(simulator.commandExecutionCounts.get("session/stop"), 1);

  const executionCount = [...simulator.commandExecutionCounts.values()]
    .reduce((total, value) => total + value, 0);
  sendCommand(simulator, "debug", {});
  assert.equal(
    [...simulator.commandExecutionCounts.values()]
      .reduce((total, value) => total + value, 0),
    executionCount,
  );
  const nack = publications.at(-1).payload;
  assert.equal(nack.reply_id, "");
  assert.equal(nack.status, "NACK");
  assert.equal(nack.reason_id, "REQUEST_ID_REQUIRED");
});

test("simulator command cache is bounded and documents its TTL", () => {
  const { simulator } = simulatorHarness();
  simulator.handleDebug = (payload) => simulator.publishCommandNack(
    payload.request_id,
    "TEST_COMPLETE",
  );
  for (let index = 0; index < COMMAND_CACHE_MAX_ENTRIES + 5; index += 1) {
    sendCommand(simulator, "debug", { request_id: `bounded-${index}` });
  }
  assert.equal(simulator.commandCache.size, COMMAND_CACHE_MAX_ENTRIES);
  assert.equal(COMMAND_CACHE_TTL_MS, 5 * 60 * 1000);
});

test("simulator status is minimal qos-one retained and deduplicated", () => {
  const { publications, simulator } = simulatorHarness();

  assert.equal(simulator.publishStatus(), true);
  assert.equal(simulator.publishStatus(), false);
  const statuses = publications.filter((entry) => entry.topic.endsWith("/status"));
  assert.equal(statuses.length, 1);
  assert.deepEqual(Object.keys(statuses[0].payload).sort(), [
    "boot_id",
    "calibrated",
    "last_error_id",
    "session_active",
    "state",
    "state_seq",
    "ts_ms",
  ]);
  assert.equal(statuses[0].payload.device_id, undefined);
  assert.equal(statuses[0].payload.ip, undefined);
  assert.equal(statuses[0].options.qos, 1);
  assert.equal(statuses[0].options.retain, true);
});

test("simulator status publishes for state sequence boot and reconnect changes", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishStatus();
  simulator.state = "READY_FOR_SESSION";
  simulator.calibrated = true;
  simulator.calibrationIdentity = {
    calibration_schema_version: 3,
    calibration_generation: 1,
    calibration_storage_status: "VALID",
    recalibration_required: false,
    profile_id: "adult-basic",
    profile_version: 1,
    profile_hash: "a82453dd6c8100d280a5b711dceca20b8df17fe45ec7dfc6fbfd0d2ad257068f",
  };
  simulator.publishStatus();
  assert.equal(publications.at(-1).payload.state_seq, 2);
  assert.equal(publications.at(-1).payload.calibration_schema_version, 3);
  assert.equal(publications.at(-1).payload.profile_id, "adult-basic");
  assert.equal(publications.at(-1).payload.profile_version, 1);

  simulator.bootId = "61ee328114907a52";
  simulator.publishStatus();
  assert.equal(publications.at(-1).payload.boot_id, "61ee328114907a52");
  assert.equal(publications.at(-1).payload.state_seq, 3);

  simulator.publishStatus(true);
  assert.equal(publications.at(-1).payload.state_seq, 4);
  assert.equal(publications.filter((entry) => entry.topic.endsWith("/status")).length, 4);
});

test("manual telemetry startup does not create duplicate status", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishStatus();
  const before = publications.filter((entry) => entry.topic.endsWith("/status")).length;
  simulator.startManualTelemetry();
  const after = publications.filter((entry) => entry.topic.endsWith("/status")).length;
  simulator.stopManualTelemetry();
  assert.ok(after - before <= 1);
});

test("simulator heartbeat is minimal and uses the five-second default", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishHeartbeat();
  const heartbeat = publications.at(-1);
  assert.ok(heartbeat.topic.endsWith("/heartbeat"));
  assert.equal(DEFAULTS.heartbeatIntervalMs, 5000);
  assert.deepEqual(Object.keys(heartbeat.payload).sort(), [
    "boot_id",
    "calibrated",
    "sensor_running",
    "session_active",
    "state",
    "state_seq",
    "ts_ms",
    "uptime_ms",
  ]);
  assert.equal(heartbeat.payload.uptime_ms, heartbeat.payload.ts_ms);
  assert.equal(heartbeat.payload.device_id, undefined);
  assert.equal(heartbeat.payload.ip, undefined);
  assert.equal(heartbeat.payload.wifi_connected, undefined);
  assert.equal(heartbeat.options.retain, false);
});

test("state-bearing simulator events share boot-aware ordering with status", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.publishStatus();
  simulator.publishHeartbeat();
  simulator.publishCalibrationEvent({
    event_id: 4002,
    result: "PASS",
    state: "READY_FOR_SESSION",
    ts_ms: simulator.tsMs(),
  });

  assert.deepEqual(
    publications.map((entry) => entry.payload.state_seq),
    [1, 2, 3],
  );
  assert.ok(publications.every((entry) => entry.payload.boot_id === simulator.bootId));
});

test("heartbeat pauses while disconnected and resumes without status traffic", () => {
  const { publications, simulator } = simulatorHarness();
  simulator.client.connected = false;
  simulator.publishHeartbeat();
  assert.equal(publications.length, 0);

  simulator.client.connected = true;
  simulator.publishHeartbeat();
  assert.equal(publications.length, 1);
  assert.ok(publications[0].topic.endsWith("/heartbeat"));
  assert.equal(
    publications.filter((entry) => entry.topic.endsWith("/status")).length,
    0,
  );
});
