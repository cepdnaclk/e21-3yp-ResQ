"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDeviceIds,
  evaluateTargets,
  parseTopic,
  payloadIdentityMismatch,
  percentile,
  scenarioPlan,
  summarizeLatency,
} = require("./phase7-load-core");

test("percentiles use nearest-rank semantics", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(percentile([], 0.95), null);
});

test("latency summary is deterministic and finite-only", () => {
  assert.deepEqual(summarizeLatency([3, Number.NaN, 1, 2]), {
    count: 3,
    minMs: 1,
    p50Ms: 2,
    p95Ms: 3,
    p99Ms: 3,
    maxMs: 3,
  });
});

test("device IDs and mixed plan are reproducible", () => {
  const ids = buildDeviceIds(5, "P7");
  assert.deepEqual(ids, ["P7-001", "P7-002", "P7-003", "P7-004", "P7-005"]);
  assert.deepEqual(scenarioPlan(ids, "mixed"), {
    active: ["P7-001", "P7-002"],
    sensorStream: ["P7-003"],
    idle: ["P7-004", "P7-005"],
  });
});

test("topic identity remains authoritative", () => {
  assert.deepEqual(parseTopic("resq/M01/telemetry"), { deviceId: "M01", suffix: "telemetry" });
  assert.equal(payloadIdentityMismatch("M01", { device_id: "M02" }), true);
  assert.equal(payloadIdentityMismatch("M01", { device_id: "M01" }), false);
  assert.equal(payloadIdentityMismatch("M01", { state: "READY_FOR_SESSION" }), false);
});

test("acceptance evaluation never weakens fixed targets", () => {
  const result = {
    invariants: {
      crossDeviceUpdates: 0,
      missingCommandReplies: 0,
      duplicateSessions: 0,
      falseStaleTransitions: 0,
      summaryMismatches: 0,
      invalidIdentityPersistence: 0,
      identityRowsAudited: 1,
      rawPayloadInOrdinaryApi: 0,
      diagnosticScoring: 0,
      continuousMemoryGrowthTrend: 0,
      emitterLeak: 0,
      crashes: 0,
    },
    rest: { overall: { p95Ms: 299 } },
    sse: { visibleUpdateLatency: { p95Ms: 499 } },
    resources: { backend: { cpuPct: { p95: 69 } } },
  };
  assert.equal(evaluateTargets(result, {
    apiP95Ms: 300,
    sseP95Ms: 500,
    backendCpuPct: 70,
  }).passed, true);
  result.invariants.crossDeviceUpdates = 1;
  assert.equal(evaluateTargets(result, {
    apiP95Ms: 300,
    sseP95Ms: 500,
    backendCpuPct: 70,
  }).passed, false);
  result.invariants.crossDeviceUpdates = 0;
  result.resources.backend.cpuPct.p95 = null;
  assert.equal(evaluateTargets(result, {
    apiP95Ms: 300,
    sseP95Ms: 500,
    backendCpuPct: 70,
  }).passed, false);
});
