"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  continuousGrowthTrend,
  findForbiddenPayloadFields,
  isOrdinaryApiEndpoint,
} = require("./phase7-load-harness");

test("ordinary payload audit detects only prohibited transport fields", () => {
  assert.deepEqual(
    findForbiddenPayloadFields({
      deviceId: "SCALE-001",
      nested: [{ rawPayload: "{}" }, { payload_json: "{}" }, { debug_raw: {} }],
      pressureBalanceScorePct: 100,
    }),
    [
      "nested[0].rawPayload",
      "nested[1].payload_json",
      "nested[2].debug_raw",
    ],
  );
  assert.deepEqual(findForbiddenPayloadFields({ deviceId: "SCALE-001" }), []);
  assert.equal(isOrdinaryApiEndpoint("GET", "/api/manikins/live"), true);
  assert.equal(isOrdinaryApiEndpoint("GET", "/api/devices/SCALE-001/firmware/diagnostics"), false);
});

test("memory trend requires a sustained final rise of at least five MiB", () => {
  const mib = 1024 * 1024;
  assert.equal(continuousGrowthTrend([1, 2, 3]), null);
  assert.equal(continuousGrowthTrend([10, 11, 10, 12].map((value) => value * mib)), 0);
  assert.equal(continuousGrowthTrend([10, 12, 14, 16].map((value) => value * mib)), 1);
});
