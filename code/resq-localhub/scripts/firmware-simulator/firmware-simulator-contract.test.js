"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
