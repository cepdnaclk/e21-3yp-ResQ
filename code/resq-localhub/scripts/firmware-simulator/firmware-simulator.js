#!/usr/bin/env node
"use strict";

const path = require("path");
const crypto = require("crypto");
const { createRequire } = require("module");

const EVENT_IDS = {
  DEBUG_COMMAND_RESULT: 1002,
  SESSION_STARTED: 2000,
  SESSION_STOPPED: 2001,
  SESSION_INTERRUPTED: 2002,
  CALIBRATION_COMMAND_RESULT: 4000,
  CALIBRATION_PROGRESS: 4001,
  CALIBRATION_FINAL_RESULT: 4002,
  TELEMETRY_COMMAND_RESULT: 6100,
  FIRMWARE_ERROR: 5000,
};

const PROGRESS_IDS = {
  CALIBRATION_STARTED: 1,
  WAITING_REFERENCE_PRESSURE: 2,
  REFERENCE_PRESSURE_MATCHED: 3,
  WAITING_BLADDER_1_PRESSURE: 4,
  BLADDER_1_PRESSURE_MATCHED: 5,
  WAITING_BLADDER_2_PRESSURE: 6,
  BLADDER_2_PRESSURE_MATCHED: 7,
  HALL_BASELINE_CAPTURED: 8,
  WAITING_FULL_PRESS: 9,
  FULL_PRESS_CAPTURED: 10,
  CALIBRATION_SAVED: 11,
  CALIBRATION_FAILED: 12,
};

const ACTION_IDS = {
  NO_ACTION_REQUIRED: 0,
  WAIT_OR_CANCEL: 2,
  CHECK_SENSOR_AND_RETRY: 4,
  MOVE_TO_PAIRED_IDLE: 6,
  MOVE_TO_ERROR: 8,
  STOP_SESSION_AND_RETURN_READY: 11,
  DEVICE_IN_ERROR_USE_SYSTEM_RECOVERY: 13,
};

const PRESSURE_CENTER_SCORE_THRESHOLD_PCT = 88;
const PAUSE_CONDITION_THRESHOLD_S = 1;
const COMMAND_CACHE_MAX_ENTRIES = 32;
const COMMAND_CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULTS = {
  deviceId: process.env.DEVICE_ID || "M01",
  mqttUrl: process.env.MQTT_URL || "mqtt://127.0.0.1:1883",
  sessionId: process.env.SESSION_ID || "S-SIM-001",
  profileId: process.env.PROFILE_ID || "adult-basic",
  calibrationMode: process.env.CALIBRATION_MODE || "pass",
  telemetryIntervalMs: numberFromEnv("TELEMETRY_INTERVAL_MS", 200),
  heartbeatIntervalMs: numberFromEnv("HEARTBEAT_INTERVAL_MS", 5000),
  exitAfterMs: numberFromEnv("EXIT_AFTER_MS", 0),
};

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const mqtt = loadMqtt();
  const simulator = new FirmwareSimulator(mqtt, options);
  simulator.start();
}

class FirmwareSimulator {
  constructor(mqtt, options) {
    this.mqtt = mqtt;
    this.options = options;
    this.client = null;
    this.state = options.simulateError ? "ERROR" : "PAIRED_IDLE";
    this.calibrated = false;
    this.sessionActive = false;
    this.currentSessionId = options.sessionId;
    this.lastErrorId = options.simulateError ? "06201" : "00000";
    this.telemetryCount = 0;
    this.latestSessionMetric = null;
    this.manualTelemetryCount = 0;
    this.heartbeatTimer = null;
    this.telemetryTimer = null;
    this.manualTelemetryTimer = null;
    this.manualTelemetryIntervalMs = 200;
    this.calibrationTimers = [];
    this.startedAt = Date.now();
    this.bootId = options.bootId || crypto.randomBytes(8).toString("hex");
    this.statusStateSeq = 0;
    this.lastStatusEffective = null;
    this.commandCache = new Map();
    this.commandExecutionCounts = new Map();
    this.activeCommandCapture = null;
  }

  start() {
    const clientId = `resq-firmware-sim-${this.options.deviceId}-${Date.now().toString(36)}`;
    this.client = this.mqtt.connect(this.options.mqttUrl, {
      clientId,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 3000,
    });

    this.client.on("connect", () => {
      this.log(`connected to ${this.options.mqttUrl}`);
      this.client.subscribe(this.topic("cmd/#"), { qos: 0 }, (error) => {
        if (error) {
          this.log(`subscribe failed: ${error.message || error}`);
          return;
        }
        this.log(`subscribed to ${this.topic("cmd/#")}`);
      });
      this.publishStatus(true);
      this.publishHeartbeat();
      this.startHeartbeat();
      if (this.options.simulateError) {
        this.publishError("06201", ACTION_IDS.DEVICE_IN_ERROR_USE_SYSTEM_RECOVERY);
      }
    });

    this.client.on("message", (topic, payload) => this.handleCommand(topic, payload));
    this.client.on("error", (error) => this.log(`mqtt error: ${error.message || error}`));
    this.client.on("close", () => this.log("mqtt connection closed"));

    process.on("SIGINT", () => this.stop(0));
    process.on("SIGTERM", () => this.stop(0));

    if (this.options.exitAfterMs > 0) {
      setTimeout(() => this.stop(0), this.options.exitAfterMs);
    }
  }

  handleCommand(topic, payloadBuffer) {
    const prefix = this.topic("cmd/");
    if (!topic.startsWith(prefix)) {
      return;
    }

    const command = topic.slice(prefix.length);
    const payload = parseJson(payloadBuffer.toString("utf8"));
    const requestId = stringOr(payload.request_id, stringOr(payload.command_id, ""));
    this.log(`command ${command} ${JSON.stringify(payload)}`);

    if (!requestId) {
      this.publishCommandNack("", "REQUEST_ID_REQUIRED");
      this.log(`rejected command without request_id: ${command}`);
      return;
    }

    payload.request_id = requestId;
    this.expireCommandCache();
    const cacheKey = `${command}\u0000${requestId}`;
    const cached = this.commandCache.get(cacheKey);
    if (cached?.state === "COMPLETE") {
      cached.lastAccessedAt = Date.now();
      cached.responses.forEach((response) => {
        this.publish(response.suffix, response.payload, response.options);
      });
      this.log(`replayed command response ${command} request_id=${requestId}`);
      return;
    }
    if (cached?.state === "PENDING") {
      this.log(`suppressed in-flight duplicate ${command} request_id=${requestId}`);
      return;
    }
    if (!this.reserveCommandCacheEntry(cacheKey, command, requestId)) {
      this.publishCommandNack(requestId, "COMMAND_DEDUP_BUSY");
      return;
    }

    this.commandExecutionCounts.set(
      command,
      (this.commandExecutionCounts.get(command) || 0) + 1,
    );
    this.activeCommandCapture = { requestId, responses: [] };
    try {
      switch (command) {
        case "calibration/start":
          this.handleCalibrationStart(payload);
          break;
        case "calibration/cancel":
          this.handleCalibrationCancel(payload);
          break;
        case "session/start":
          this.handleSessionStart(payload);
          break;
        case "session/stop":
          this.handleSessionStop(payload);
          break;
        case "telemetry":
          this.handleTelemetryControl(payload);
          break;
        case "debug":
          this.handleDebug(payload);
          break;
        case "system/retry":
        case "system/reset":
        case "system/flush-config":
          this.state = "PAIRED_IDLE";
          this.lastErrorId = "00000";
          this.publishEvent("events", {
            event_id: EVENT_IDS.DEBUG_COMMAND_RESULT,
            reply_id: requestId,
            status: "ACK",
            state: this.state,
            reason_id: "00000",
            action_id: ACTION_IDS.NO_ACTION_REQUIRED,
            ts_ms: this.tsMs(),
          });
          this.publishStatus();
          break;
        default:
          this.publishCommandNack(requestId, "UNKNOWN_COMMAND");
          this.log(`rejected unsupported command: ${command}`);
      }
    } finally {
      const completedAt = Date.now();
      const entry = this.commandCache.get(cacheKey);
      if (entry) {
        entry.state = "COMPLETE";
        entry.completedAt = completedAt;
        entry.lastAccessedAt = completedAt;
        entry.responses = this.activeCommandCapture.responses;
      }
      this.activeCommandCapture = null;
    }
  }

  reserveCommandCacheEntry(cacheKey, command, requestId) {
    if (this.commandCache.size >= COMMAND_CACHE_MAX_ENTRIES) {
      const oldestComplete = [...this.commandCache.entries()]
        .filter(([, entry]) => entry.state === "COMPLETE")
        .sort((left, right) => left[1].completedAt - right[1].completedAt)[0];
      if (!oldestComplete) {
        return false;
      }
      this.commandCache.delete(oldestComplete[0]);
    }
    const now = Date.now();
    this.commandCache.set(cacheKey, {
      command,
      requestId,
      state: "PENDING",
      createdAt: now,
      lastAccessedAt: now,
      responses: [],
    });
    return true;
  }

  expireCommandCache() {
    const now = Date.now();
    for (const [key, entry] of this.commandCache.entries()) {
      if (entry.state === "COMPLETE" && now - entry.completedAt >= COMMAND_CACHE_TTL_MS) {
        this.commandCache.delete(key);
      }
    }
  }

  publishCommandNack(replyId, reasonId) {
    this.publishEvent("events", {
      event_id: 1000,
      reply_id: replyId,
      status: "NACK",
      state: this.state,
      reason_id: reasonId,
      action_id: ACTION_IDS.CHECK_SENSOR_AND_RETRY,
      ts_ms: this.tsMs(),
    });
  }

  handleCalibrationStart(payload) {
    this.clearCalibrationTimers();
    this.stopTelemetry();
    this.stopManualTelemetry();
    this.sessionActive = false;
    this.state = "CALIBRATING";
    this.calibrated = false;
    this.lastErrorId = "00000";
    this.publishStatus();
    this.publishCalibrationEvent({
      event_id: EVENT_IDS.CALIBRATION_COMMAND_RESULT,
      reply_id: payload.request_id,
      status: "ACK",
      state: this.state,
      reason_id: "00000",
      action_id: ACTION_IDS.WAIT_OR_CANCEL,
      ts_ms: this.tsMs(),
    });

    const progressIds = [
      PROGRESS_IDS.CALIBRATION_STARTED,
      PROGRESS_IDS.WAITING_REFERENCE_PRESSURE,
      PROGRESS_IDS.REFERENCE_PRESSURE_MATCHED,
      PROGRESS_IDS.WAITING_BLADDER_1_PRESSURE,
      PROGRESS_IDS.BLADDER_1_PRESSURE_MATCHED,
      PROGRESS_IDS.WAITING_BLADDER_2_PRESSURE,
      PROGRESS_IDS.BLADDER_2_PRESSURE_MATCHED,
      PROGRESS_IDS.HALL_BASELINE_CAPTURED,
      PROGRESS_IDS.WAITING_FULL_PRESS,
      PROGRESS_IDS.FULL_PRESS_CAPTURED,
    ];

    progressIds.forEach((progressId, index) => {
      this.calibrationTimers.push(setTimeout(() => {
        this.publishCalibrationEvent({
          event_id: EVENT_IDS.CALIBRATION_PROGRESS,
          reply_id: payload.request_id,
          progress_id: progressId,
          state: "CALIBRATING",
          reason_id: "00000",
          action_id: ACTION_IDS.WAIT_OR_CANCEL,
          ts_ms: this.tsMs(),
        });
      }, 150 + index * 120));
    });

    this.calibrationTimers.push(setTimeout(() => {
      if (this.options.calibrationMode === "fail") {
        this.state = "CALIBRATION_FAIL";
        this.calibrated = false;
        this.lastErrorId = "06401";
        this.publishCalibrationEvent({
          event_id: EVENT_IDS.CALIBRATION_FINAL_RESULT,
          reply_id: payload.request_id,
          result: "FAIL",
          status: "ACK",
          progress_id: PROGRESS_IDS.CALIBRATION_FAILED,
          state: this.state,
          reason_id: "06401",
          action_id: ACTION_IDS.CHECK_SENSOR_AND_RETRY,
          calibration_schema_version: 1,
          calibration_generation: 1,
          calibration_storage_status: "INVALID",
          recalibration_required: true,
          profile_id: stringOr(payload.profile_id, this.options.profileId),
          profile_version: payload.profile_version,
          profile_hash: payload.profile_hash,
          ts_ms: this.tsMs(),
        });
        this.publishStatus();
        return;
      }

      this.state = "READY_FOR_SESSION";
      this.calibrated = true;
      this.publishCalibrationEvent({
        event_id: EVENT_IDS.CALIBRATION_FINAL_RESULT,
        reply_id: payload.request_id,
        result: "PASS",
        status: "ACK",
        progress_id: PROGRESS_IDS.CALIBRATION_SAVED,
        state: this.state,
        reason_id: "00000",
        action_id: ACTION_IDS.NO_ACTION_REQUIRED,
        calibration_schema_version: 1,
        calibration_generation: 1,
        calibration_storage_status: "VALID",
        recalibration_required: false,
        profile_id: stringOr(payload.profile_id, this.options.profileId),
        profile_version: payload.profile_version,
        profile_hash: payload.profile_hash,
        ts_ms: this.tsMs(),
      });
      this.publishStatus();
    }, 150 + progressIds.length * 120));
  }

  handleCalibrationCancel(payload) {
    this.clearCalibrationTimers();
    this.state = "PAIRED_IDLE";
    this.calibrated = false;
    this.sessionActive = false;
    this.publishCalibrationEvent({
      event_id: EVENT_IDS.CALIBRATION_FINAL_RESULT,
      reply_id: payload.request_id,
      result: "CANCELLED",
      status: "ACK",
      progress_id: PROGRESS_IDS.CALIBRATION_FAILED,
      state: this.state,
      reason_id: "00000",
      action_id: ACTION_IDS.MOVE_TO_PAIRED_IDLE,
      ts_ms: this.tsMs(),
    });
    this.publishStatus();
  }

  handleSessionStart(payload) {
    this.stopManualTelemetry();
    this.currentSessionId = stringOr(payload.session_id, this.options.sessionId);
    this.telemetryCount = 0;
    this.latestSessionMetric = null;
    this.sessionActive = true;
    this.state = "SESSION_ACTIVE";
    this.publishEvent("events", {
      event_id: EVENT_IDS.SESSION_STARTED,
      reply_id: payload.request_id,
      status: "ACK",
      state: this.state,
      session_id: this.currentSessionId,
      reason_id: "00000",
      action_id: ACTION_IDS.NO_ACTION_REQUIRED,
      ts_ms: this.tsMs(),
    });
    this.publishStatus();
    this.startTelemetry();
    if (this.options.simulateInterrupted) {
      setTimeout(() => this.interruptSession(payload.request_id), 3000);
    }
  }

  handleSessionStop(payload) {
    this.stopTelemetry();
    const finalMetric = this.latestSessionMetric || {
      compression_count: 0,
      valid_compression_count: 0,
      recoil_ok_count: 0,
      incomplete_recoil_count: 0,
    };
    this.sessionActive = false;
    this.state = this.calibrated ? "READY_FOR_SESSION" : "PAIRED_IDLE";
    this.publishEvent("events", {
      event_id: EVENT_IDS.SESSION_STOPPED,
      reply_id: payload.request_id,
      status: "ACK",
      result: "STOPPED",
      state: this.state,
      session_id: this.currentSessionId,
      total_compressions: finalMetric.compression_count,
      valid_compressions: finalMetric.valid_compression_count,
      recoil_ok_count: finalMetric.recoil_ok_count,
      incomplete_recoil_count: finalMetric.incomplete_recoil_count,
      reason_id: "00000",
      action_id: ACTION_IDS.STOP_SESSION_AND_RETURN_READY,
      ts_ms: this.tsMs(),
    });
    this.publishStatus();
  }

  handleDebug(payload) {
    this.publishDebugSnapshot(payload.request_id);
    this.publishEvent("events", {
      event_id: EVENT_IDS.DEBUG_COMMAND_RESULT,
      reply_id: payload.request_id,
      status: "ACK",
      state: this.state,
      reason_id: "00000",
      action_id: ACTION_IDS.NO_ACTION_REQUIRED,
      ts_ms: this.tsMs(),
    });
  }

  handleTelemetryControl(payload) {
    const action = String(payload.action || "").trim().toUpperCase();
    if (action === "START") {
      const intervalMs = Number(payload.interval_ms);
      if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 1000) {
        this.publishTelemetryControlResult(payload.request_id, "NACK", "07101");
        return;
      }
      if (this.sessionActive || this.state === "CALIBRATING") {
        this.publishTelemetryControlResult(payload.request_id, "NACK", "06301");
        return;
      }
      this.manualTelemetryIntervalMs = intervalMs;
      this.startManualTelemetry();
      this.publishTelemetryControlResult(payload.request_id, "ACK", "00000");
      return;
    }

    if (action === "STOP") {
      this.stopManualTelemetry();
      this.publishTelemetryControlResult(payload.request_id, "ACK", "00000");
      return;
    }

    this.publishTelemetryControlResult(payload.request_id, "NACK", "07101");
  }

  publishTelemetryControlResult(replyId, status, reasonId) {
    this.publishEvent("events", {
      event_id: EVENT_IDS.TELEMETRY_COMMAND_RESULT,
      reply_id: replyId,
      status,
      state: this.state,
      reason_id: reasonId,
      action_id: status === "ACK" ? ACTION_IDS.NO_ACTION_REQUIRED : ACTION_IDS.CHECK_SENSOR_AND_RETRY,
      ts_ms: this.tsMs(),
    });
  }

  interruptSession(replyId) {
    if (!this.sessionActive) {
      return;
    }
    this.stopTelemetry();
    this.sessionActive = false;
    this.state = "SESSION_INTERRUPTED";
    this.publishEvent("events", {
      event_id: EVENT_IDS.SESSION_INTERRUPTED,
      reply_id: replyId,
      status: "ACK",
      result: "INTERRUPTED",
      state: this.state,
      session_id: this.currentSessionId,
      reason_id: "06301",
      action_id: ACTION_IDS.STOP_SESSION_AND_RETURN_READY,
      ts_ms: this.tsMs(),
    });
    this.publishStatus();
  }

  publishStatus(force = false) {
    const effective = {
      state: this.state,
      session_active: this.sessionActive,
      calibrated: this.calibrated,
      last_error_id: this.lastErrorId,
      boot_id: this.bootId,
    };
    if (this.sessionActive || this.state === "SESSION_INTERRUPTED") {
      effective.session_id = this.currentSessionId;
    }
    const fingerprint = JSON.stringify(effective);
    if (!force && fingerprint === this.lastStatusEffective) {
      return false;
    }
    this.statusStateSeq += 1;
    this.publish("status", {
      ...effective,
      state_seq: this.statusStateSeq,
      ts_ms: this.tsMs(),
    }, { qos: 1, retain: true });
    this.lastStatusEffective = fingerprint;
    return true;
  }

  publishHeartbeat() {
    const nowMs = this.tsMs();
    this.publish("heartbeat", {
      state: this.state,
      session_active: this.sessionActive,
      sensor_running: this.sessionActive || Boolean(this.manualTelemetryTimer),
      calibrated: this.calibrated,
      // Compatibility alias; ts_ms is the canonical monotonic timestamp.
      uptime_ms: nowMs,
      ts_ms: nowMs,
    });
  }

  publishTelemetry() {
    if (!this.sessionActive) {
      return;
    }
    this.telemetryCount += 1;
    const wobble = Math.sin(this.telemetryCount / 3);
    const depthProgress = clamp(0.75 + wobble * 0.12, 0, 1);
    const metric = normalizeSessionMetric({
      session_id: this.currentSessionId,
      state: "SESSION_ACTIVE",
      depth_mm: depthProgress * 55,
      depth_progress: depthProgress,
      depth_ok: Math.abs(wobble) < 0.85,
      rate_cpm: 108 + Math.round(wobble * 8),
      compression_count: this.telemetryCount,
      valid_compression_count: Math.max(0, this.telemetryCount - 1),
      recoil_ok: this.telemetryCount % 7 !== 0,
      recoil_ok_count: Math.max(0, this.telemetryCount - 1),
      incomplete_recoil_count: this.telemetryCount > 5 ? 1 : 0,
      pause_s: this.telemetryCount % 20 === 0 ? 0.7 : 0.2,
      hand_placement: "CENTER",
      pressure_balance_score_pct: 92 + wobble * 3,
      ts_ms: this.tsMs(),
    });
    this.latestSessionMetric = metric;
    this.publish("telemetry", metric);
  }

  publishSensorStream() {
    if (!this.manualTelemetryTimer) {
      return;
    }
    this.manualTelemetryCount += 1;
    const wobble = Math.sin(this.manualTelemetryCount / 4);
    const pressure1Valid = this.manualTelemetryCount % 13 !== 0;
    this.publish("telemetry", {
      telemetry_mode: "SENSOR_STREAM",
      state: this.state,
      pressure_0_raw: 1230 + this.manualTelemetryCount,
      pressure_0_raw_valid: true,
      pressure_1_raw: 1650 + this.manualTelemetryCount,
      pressure_1_raw_valid: pressure1Valid,
      pressure_2_raw: 1640 + this.manualTelemetryCount,
      pressure_2_raw_valid: true,
      hall_raw: 2990 + this.manualTelemetryCount,
      hall_raw_valid: true,
      pressure_0_kpa: Number((0.8 + wobble * 0.12).toFixed(3)),
      pressure_0_kpa_valid: true,
      pressure_1_kpa: Number((1.4 + wobble * 0.08).toFixed(3)),
      pressure_1_kpa_valid: pressure1Valid,
      pressure_2_kpa: Number((1.35 - wobble * 0.06).toFixed(3)),
      pressure_2_kpa_valid: true,
      pressure_kpa_valid: pressure1Valid,
      hall_mm: Number((12.5 + wobble * 2.5).toFixed(2)),
      hall_progress: Number(clamp(0.42 + wobble * 0.08, 0, 1).toFixed(3)),
      hall_mm_valid: true,
      pressure_saturation_mask: this.manualTelemetryCount % 17 === 0 ? 2 : 0,
      interval_ms: this.manualTelemetryIntervalMs,
      ts_ms: this.tsMs(),
    });
  }

  publishDebugSnapshot(requestId) {
    const offset = this.telemetryCount * 3;
    this.publish("debug", {
      reply_id: requestId,
      source: "DIRECT_SENSOR_SNAPSHOT",
      pressure_0_raw: 1230 + offset,
      pressure_1_raw: 1650 + offset,
      pressure_2_raw: 1640 + offset,
      hall_raw: 2990 + offset,
      ts_ms: this.tsMs(),
    });
  }

  publishError(reasonId, actionId) {
    this.state = "ERROR";
    this.lastErrorId = reasonId;
    this.publishEvent("events/error", {
      event_id: EVENT_IDS.FIRMWARE_ERROR,
      reason_id: reasonId,
      state: "ERROR",
      action_id: actionId,
      ts_ms: this.tsMs(),
    });
    this.publishStatus();
  }

  publishCalibrationEvent(payload) {
    this.publish("events/calibration", payload, {
      qos: payload.event_id === EVENT_IDS.CALIBRATION_FINAL_RESULT ? 1 : 0,
    });
  }

  publishEvent(suffix, payload) {
    this.publish(suffix, payload);
  }

  publish(suffix, payload, options = {}) {
    if (!this.client || !this.client.connected) {
      return;
    }
    const topic = this.topic(suffix);
    const stateBearing = suffix === "status"
      || suffix === "heartbeat"
      || suffix === "events"
      || suffix === "events/calibration"
      || suffix === "events/error";
    const orderedPayload = stateBearing && (!payload.boot_id || !Number.isInteger(payload.state_seq))
      ? {
        ...payload,
        boot_id: this.bootId,
        state_seq: ++this.statusStateSeq,
      }
      : payload;
    const json = JSON.stringify(orderedPayload);
    if (
      this.activeCommandCapture
      && orderedPayload.reply_id === this.activeCommandCapture.requestId
    ) {
      this.activeCommandCapture.responses.push({
        suffix,
        payload: JSON.parse(json),
        options: { ...options },
      });
    }
    this.client.publish(topic, json, {
      qos: Number.isInteger(options.qos) ? options.qos : 0,
      retain: Boolean(options.retain),
    });
    this.log(`publish ${topic} ${json}`);
  }

  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.publishHeartbeat(), this.options.heartbeatIntervalMs);
  }

  startTelemetry() {
    this.stopTelemetry();
    this.publishTelemetry();
    this.telemetryTimer = setInterval(() => this.publishTelemetry(), this.options.telemetryIntervalMs);
  }

  stopTelemetry() {
    clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  startManualTelemetry() {
    this.stopManualTelemetry();
    this.state = this.calibrated ? "READY_FOR_SESSION" : "PAIRED_IDLE";
    this.manualTelemetryTimer = setInterval(() => this.publishSensorStream(), this.manualTelemetryIntervalMs);
    this.publishSensorStream();
  }

  stopManualTelemetry() {
    clearInterval(this.manualTelemetryTimer);
    this.manualTelemetryTimer = null;
  }

  clearCalibrationTimers() {
    this.calibrationTimers.forEach(clearTimeout);
    this.calibrationTimers = [];
  }

  topic(suffix) {
    return `resq/${this.options.deviceId}/${suffix}`;
  }

  tsMs() {
    return Date.now() - this.startedAt;
  }

  stop(code) {
    this.clearCalibrationTimers();
    this.stopTelemetry();
    this.stopManualTelemetry();
    clearInterval(this.heartbeatTimer);
    if (this.client) {
      this.client.end(true, () => process.exit(code));
      setTimeout(() => process.exit(code), 500);
      return;
    }
    process.exit(code);
  }

  log(message) {
    if (!this.options.quiet) {
      console.log(`[firmware-sim:${this.options.deviceId}] ${message}`);
    }
  }
}

function loadMqtt() {
  try {
    return require("mqtt");
  } catch {
    const desktopPackage = path.resolve(__dirname, "..", "..", "apps", "localhub-desktop", "package.json");
    return createRequire(desktopPackage)("mqtt");
  }
}

function parseArgs(args) {
  const options = {
    ...DEFAULTS,
    simulateError: false,
    simulateInterrupted: false,
    quiet: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => args[++index];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--device-id":
        options.deviceId = requiredValue(arg, next());
        break;
      case "--mqtt-url":
        options.mqttUrl = requiredValue(arg, next());
        break;
      case "--session-id":
        options.sessionId = requiredValue(arg, next());
        break;
      case "--profile-id":
        options.profileId = requiredValue(arg, next());
        break;
      case "--calibration-mode":
        options.calibrationMode = requiredValue(arg, next()).toLowerCase();
        if (!["pass", "fail"].includes(options.calibrationMode)) {
          throw new Error("--calibration-mode must be pass or fail");
        }
        break;
      case "--telemetry-interval-ms":
        options.telemetryIntervalMs = positiveInteger(arg, next());
        break;
      case "--heartbeat-interval-ms":
        options.heartbeatIntervalMs = positiveInteger(arg, next());
        break;
      case "--exit-after-ms":
        options.exitAfterMs = positiveInteger(arg, next());
        break;
      case "--simulate-error":
        options.simulateError = true;
        break;
      case "--simulate-interrupted":
        options.simulateInterrupted = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`ResQ LocalHub firmware simulator

Usage:
  node scripts/firmware-simulator/firmware-simulator.js [options]

Options:
  --device-id <id>                 Device ID, default ${DEFAULTS.deviceId}
  --mqtt-url <url>                 MQTT URL, default ${DEFAULTS.mqttUrl}
  --session-id <id>                Default session ID, default ${DEFAULTS.sessionId}
  --profile-id <id>                Profile ID, default ${DEFAULTS.profileId}
  --calibration-mode <pass|fail>   Calibration result mode, default ${DEFAULTS.calibrationMode}
  --telemetry-interval-ms <ms>     Telemetry interval, default ${DEFAULTS.telemetryIntervalMs}
  --heartbeat-interval-ms <ms>     Heartbeat interval, default ${DEFAULTS.heartbeatIntervalMs}
  --exit-after-ms <ms>             Exit automatically after this many ms
  --simulate-error                 Start in ERROR and publish an error event
  --simulate-interrupted           Interrupt a started session after a short delay
  --quiet                          Suppress publish logs
  --help, -h                       Show this help

Environment variables:
  DEVICE_ID, MQTT_URL, SESSION_ID, PROFILE_ID, CALIBRATION_MODE,
  TELEMETRY_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, EXIT_AFTER_MS
`);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function requiredValue(flag, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${flag} requires a value`);
  }
  return value.trim();
}

function positiveInteger(flag, value) {
  const number = Number(requiredValue(flag, value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return Math.trunc(number);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deriveSessionFlags(metric) {
  const flags = [];
  if (metric.depth_ok) {
    flags.push("DEPTH_OK");
  }
  if (metric.rate_cpm > 0.1) {
    flags.push(metric.rate_cpm < 100 ? "RATE_SLOW" : metric.rate_cpm <= 120 ? "RATE_OK" : "RATE_FAST");
  }
  if (metric.recoil_ok) {
    flags.push("RECOIL_OK");
  }
  if (metric.pause_s > PAUSE_CONDITION_THRESHOLD_S) {
    flags.push("PAUSE_DETECTED");
  }
  if (metric.hand_placement === "LEFT") {
    flags.push("HAND_LEFT");
  } else if (metric.hand_placement === "RIGHT") {
    flags.push("HAND_RIGHT");
  } else if (metric.hand_placement === "SKEWED") {
    flags.push("HAND_SKEWED");
  }
  return flags.join(",");
}

function normalizeSessionMetric(metric) {
  const normalized = { ...metric };
  const score = Number.isFinite(normalized.pressure_balance_score_pct)
    ? clamp(normalized.pressure_balance_score_pct, 0, 100)
    : 0;
  normalized.depth_mm = roundTo(normalized.depth_mm, 3);
  normalized.depth_progress = roundTo(normalized.depth_progress, 3);
  normalized.rate_cpm = roundTo(normalized.rate_cpm, 1);
  normalized.pause_s = roundTo(normalized.pause_s, 3);
  normalized.pressure_balance_score_pct = roundTo(score, 2);
  // Deprecated compatibility alias; remove only after LocalHub Phase 6.
  normalized.pressure_balance_pct = normalized.pressure_balance_score_pct;
  if (score >= PRESSURE_CENTER_SCORE_THRESHOLD_PCT) {
    normalized.hand_placement = "CENTER";
  } else if (normalized.hand_placement === "CENTER") {
    normalized.hand_placement = "SKEWED";
  }
  normalized.flags = deriveSessionFlags(normalized);
  return normalized;
}

function roundTo(value, digits) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

module.exports = {
  COMMAND_CACHE_MAX_ENTRIES,
  COMMAND_CACHE_TTL_MS,
  DEFAULTS,
  FirmwareSimulator,
  PAUSE_CONDITION_THRESHOLD_S,
  PRESSURE_CENTER_SCORE_THRESHOLD_PCT,
  clamp,
  deriveSessionFlags,
  normalizeSessionMetric,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
