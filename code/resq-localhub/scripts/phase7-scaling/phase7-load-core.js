"use strict";

function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function summarizeLatency(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    minMs: finite.length ? Number(Math.min(...finite).toFixed(3)) : null,
    p50Ms: percentile(finite, 0.50),
    p95Ms: percentile(finite, 0.95),
    p99Ms: percentile(finite, 0.99),
    maxMs: finite.length ? Number(Math.max(...finite).toFixed(3)) : null,
  };
}

function buildDeviceIds(count, prefix = "SCALE") {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("device count must be an integer between 1 and 200");
  }
  return Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`);
}

function parseTopic(topic) {
  const parts = String(topic || "").split("/");
  if (parts.length < 3 || parts[0] !== "resq" || !parts[1]) {
    return null;
  }
  return {
    deviceId: parts[1],
    suffix: parts.slice(2).join("/"),
  };
}

function payloadIdentityMismatch(topicDeviceId, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  for (const key of ["device_id", "deviceId"]) {
    if (typeof payload[key] === "string" && payload[key].trim() && payload[key].trim() !== topicDeviceId) {
      return true;
    }
  }
  return false;
}

function scenarioPlan(deviceIds, scenario) {
  const ids = [...deviceIds];
  switch (scenario) {
    case "idle":
      return { active: [], sensorStream: [], idle: ids };
    case "session":
    case "soak":
      return { active: ids, sensorStream: [], idle: [] };
    case "mixed": {
      const activeCount = Math.max(1, Math.floor(ids.length / 2));
      const streamCount = Math.max(ids.length >= 5 ? 1 : 0, Math.floor(ids.length / 4));
      return {
        active: ids.slice(0, activeCount),
        sensorStream: ids.slice(activeCount, activeCount + streamCount),
        idle: ids.slice(activeCount + streamCount),
      };
    }
    case "command-burst":
    case "reconnect":
      return { active: [], sensorStream: [], idle: ids };
    default:
      throw new Error(`unsupported scenario: ${scenario}`);
  }
}

function evaluateTargets(result, targets = {}) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };
  check(result.invariants.crossDeviceUpdates === 0, "cross-device updates must be zero");
  check(result.invariants.missingCommandReplies === 0, "missing QoS 1 command replies must be zero");
  check(result.invariants.duplicateSessions === 0, "duplicate sessions must be zero");
  check(result.invariants.falseStaleTransitions === 0, "false stale transitions must be zero");
  check(result.invariants.summaryMismatches === 0, "session summary mismatches must be zero");
  check(Number.isInteger(result.invariants.invalidIdentityPersistence), "identity persistence audit evidence is required");
  check(result.invariants.identityRowsAudited > 0, "persisted profile identity rows must be audited");
  check(result.invariants.invalidIdentityPersistence === 0, "invalid identity persistence must be zero");
  check(Number.isInteger(result.invariants.rawPayloadInOrdinaryApi), "ordinary REST/SSE payload audit evidence is required");
  check(result.invariants.rawPayloadInOrdinaryApi === 0, "raw payload in ordinary REST/SSE must be zero");
  check(Number.isInteger(result.invariants.diagnosticScoring), "diagnostic scoring audit evidence is required");
  check(result.invariants.diagnosticScoring === 0, "diagnostic scoring must be zero");
  check(Number.isInteger(result.invariants.continuousMemoryGrowthTrend), "memory growth trend evidence is required");
  check(result.invariants.continuousMemoryGrowthTrend === 0, "continuous memory growth trend must be zero");
  if (targets.apiP95Ms != null && result.rest.overall.p95Ms != null) {
    check(result.rest.overall.p95Ms < targets.apiP95Ms, `REST p95 must be below ${targets.apiP95Ms} ms`);
  } else if (targets.apiP95Ms != null) {
    check(false, "REST p95 evidence is required");
  }
  if (targets.sseP95Ms != null && result.sse.visibleUpdateLatency.p95Ms != null) {
    check(result.sse.visibleUpdateLatency.p95Ms < targets.sseP95Ms, `SSE p95 must be below ${targets.sseP95Ms} ms`);
  } else if (targets.sseP95Ms != null) {
    check(false, "SSE p95 evidence is required");
  }
  if (targets.backendCpuPct != null && result.resources.backend.cpuPct.p95 != null) {
    check(result.resources.backend.cpuPct.p95 < targets.backendCpuPct, `backend CPU p95 must be below ${targets.backendCpuPct}%`);
  } else if (targets.backendCpuPct != null) {
    check(false, "backend CPU p95 evidence is required");
  }
  check(Number.isInteger(result.invariants.emitterLeak), "server SSE emitter count evidence is required");
  check(result.invariants.emitterLeak === 0, "SSE emitter leak must be zero");
  check(result.invariants.crashes === 0, "crashes must be zero");
  return {
    passed: failures.length === 0,
    failures,
  };
}

module.exports = {
  buildDeviceIds,
  evaluateTargets,
  parseTopic,
  payloadIdentityMismatch,
  percentile,
  scenarioPlan,
  summarizeLatency,
};
