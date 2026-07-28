"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { DEFAULTS, FirmwareSimulator } = require("./firmware-simulator.js");

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

function depthFlagsConsistent(payload) {
  if (typeof payload.depth_ok !== "boolean" || typeof payload.flags !== "string") {
    return true;
  }
  const hasDepthOk = payload.flags.split(",").map((value) => value.trim()).includes("DEPTH_OK");
  return payload.depth_ok === hasDepthOk;
}

function pressureBalanceValid(payload) {
  const score = payload.pressure_balance_pct;
  if (score === undefined) {
    return true;
  }
  if (typeof score !== "number" || score < 0 || score > 100) {
    return false;
  }
  return payload.hand_placement !== "CENTER" || score >= 88;
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

test("fixture modes remain separated", () => {
  assert.equal(fixtures.minimal.sensorStream.telemetry_mode, "SENSOR_STREAM");
  assert.equal(fixtures.minimal.debugSnapshot.source, "DIRECT_SENSOR_SNAPSHOT");
  assert.equal(fixtures.minimal.calibrationProgress.event_id, 4001);
  assert.equal(fixtures.minimal.calibrationResult.event_id, 4002);
  assert.equal(fixtures.minimal.errorEvent.event_id, 5000);
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
  simulator.publishStatus();
  assert.equal(publications.at(-1).payload.state_seq, 2);

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
    "calibrated",
    "sensor_running",
    "session_active",
    "state",
    "ts_ms",
    "uptime_ms",
  ]);
  assert.equal(heartbeat.payload.uptime_ms, heartbeat.payload.ts_ms);
  assert.equal(heartbeat.payload.device_id, undefined);
  assert.equal(heartbeat.payload.ip, undefined);
  assert.equal(heartbeat.payload.wifi_connected, undefined);
  assert.equal(heartbeat.options.retain, false);
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
