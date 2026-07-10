#!/usr/bin/env node
"use strict";

const path = require("path");
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

const DEFAULTS = {
  deviceId: process.env.DEVICE_ID || "M01",
  mqttUrl: process.env.MQTT_URL || "mqtt://127.0.0.1:1883",
  sessionId: process.env.SESSION_ID || "S-SIM-001",
  profileId: process.env.PROFILE_ID || "adult-basic",
  calibrationMode: process.env.CALIBRATION_MODE || "pass",
  telemetryIntervalMs: numberFromEnv("TELEMETRY_INTERVAL_MS", 200),
  heartbeatIntervalMs: numberFromEnv("HEARTBEAT_INTERVAL_MS", 1000),
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
    this.manualTelemetryCount = 0;
    this.heartbeatTimer = null;
    this.telemetryTimer = null;
    this.manualTelemetryTimer = null;
    this.manualTelemetryIntervalMs = 200;
    this.calibrationTimers = [];
    this.startedAt = Date.now();
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
    this.log(`command ${command} ${JSON.stringify(payload)}`);

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
        this.state = "PAIRED_IDLE";
        this.lastErrorId = "00000";
        this.publishEvent("events", {
          event_id: EVENT_IDS.DEBUG_COMMAND_RESULT,
          reply_id: payload.request_id,
          status: "ACK",
          state: this.state,
          reason_id: "00000",
          action_id: ACTION_IDS.NO_ACTION_REQUIRED,
          ts_ms: this.tsMs(),
        });
        this.publishStatus(true);
        break;
      default:
        this.log(`ignored unsupported command: ${command}`);
    }
  }

  handleCalibrationStart(payload) {
    this.clearCalibrationTimers();
    this.stopTelemetry();
    this.stopManualTelemetry();
    this.sessionActive = false;
    this.state = "CALIBRATING";
    this.calibrated = false;
    this.lastErrorId = "00000";
    this.publishStatus(true);
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
          ts_ms: this.tsMs(),
        });
        this.publishStatus(true);
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
        ts_ms: this.tsMs(),
      });
      this.publishStatus(true);
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
    this.publishStatus(true);
  }

  handleSessionStart(payload) {
    this.stopManualTelemetry();
    this.currentSessionId = stringOr(payload.session_id, this.options.sessionId);
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
    this.publishStatus(true);
    this.startTelemetry();
    if (this.options.simulateInterrupted) {
      setTimeout(() => this.interruptSession(payload.request_id), 3000);
    }
  }

  handleSessionStop(payload) {
    this.stopTelemetry();
    this.sessionActive = false;
    this.state = this.calibrated ? "READY_FOR_SESSION" : "PAIRED_IDLE";
    this.publishEvent("events", {
      event_id: EVENT_IDS.SESSION_STOPPED,
      reply_id: payload.request_id,
      status: "ACK",
      result: "STOPPED",
      state: this.state,
      session_id: this.currentSessionId,
      total_compressions: this.telemetryCount,
      valid_compressions: Math.max(0, this.telemetryCount - 2),
      recoil_ok_count: Math.max(0, this.telemetryCount - 1),
      incomplete_recoil_count: this.telemetryCount > 0 ? 1 : 0,
      reason_id: "00000",
      action_id: ACTION_IDS.STOP_SESSION_AND_RETURN_READY,
      ts_ms: this.tsMs(),
    });
    this.publishStatus(true);
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
        this.publishTelemetryControlResult(payload.request_id, "NACK", "08101");
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

    this.publishTelemetryControlResult(payload.request_id, "NACK", "08102");
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
    this.publishStatus(true);
  }

  publishStatus(retain) {
    this.publish("status", {
      state: this.state,
      session_active: this.sessionActive,
      session_id: this.sessionActive ? this.currentSessionId : "",
      calibrated: this.calibrated,
      last_error_id: this.lastErrorId,
      ip: "192.168.8.120",
      ts_ms: this.tsMs(),
    }, { retain: Boolean(retain) });
  }

  publishHeartbeat() {
    this.publish("heartbeat", {
      state: this.state,
      wifi_connected: true,
      mqtt_connected: true,
      backend_registered: true,
      session_active: this.sessionActive,
      sensor_running: this.sessionActive || Boolean(this.manualTelemetryTimer),
      session_id: this.sessionActive ? this.currentSessionId : "",
      calibrated: this.calibrated,
      uptime_ms: this.tsMs(),
      ts_ms: this.tsMs(),
    });
  }

  publishTelemetry() {
    if (!this.sessionActive) {
      return;
    }
    this.telemetryCount += 1;
    const wobble = Math.sin(this.telemetryCount / 3);
    this.publish("telemetry", {
      session_id: this.currentSessionId,
      state: "SESSION_ACTIVE",
      depth_progress: clamp(0.75 + wobble * 0.12, 0, 1),
      depth_ok: Math.abs(wobble) < 0.85,
      rate_cpm: 108 + Math.round(wobble * 8),
      compression_count: this.telemetryCount,
      valid_compression_count: Math.max(0, this.telemetryCount - 1),
      recoil_ok_count: Math.max(0, this.telemetryCount - 1),
      incomplete_recoil_count: this.telemetryCount > 5 ? 1 : 0,
      pause_s: this.telemetryCount % 20 === 0 ? 0.7 : 0.2,
      hand_placement: "CENTER",
      pressure_balance_pct: 92 + wobble * 3,
      flags: "DEPTH_OK,RATE_OK,RECOIL_OK",
      ts_ms: this.tsMs(),
    });
  }

  publishSensorStream() {
    if (!this.manualTelemetryTimer) {
      return;
    }
    this.manualTelemetryCount += 1;
    const wobble = Math.sin(this.manualTelemetryCount / 4);
    this.publish("telemetry", {
      device_id: this.options.deviceId,
      telemetry_mode: "SENSOR_STREAM",
      state: this.state,
      pressure_0_kpa: Number((0.8 + wobble * 0.12).toFixed(3)),
      pressure_0_kpa_valid: true,
      pressure_1_kpa: Number((1.4 + wobble * 0.08).toFixed(3)),
      pressure_1_kpa_valid: this.manualTelemetryCount % 13 !== 0,
      pressure_2_kpa: Number((1.35 - wobble * 0.06).toFixed(3)),
      pressure_2_kpa_valid: true,
      pressure_kpa_valid: this.manualTelemetryCount % 13 !== 0,
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
      request_id: requestId,
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
    this.publishStatus(true);
  }

  publishCalibrationEvent(payload) {
    this.publishEvent("events/calibration", payload);
  }

  publishEvent(suffix, payload) {
    this.publish(suffix, payload);
  }

  publish(suffix, payload, options = {}) {
    if (!this.client || !this.client.connected) {
      return;
    }
    const topic = this.topic(suffix);
    const json = JSON.stringify(payload);
    this.client.publish(topic, json, { qos: 0, retain: Boolean(options.retain) });
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
    this.publishStatus(false);
  }

  stopManualTelemetry() {
    clearInterval(this.manualTelemetryTimer);
    this.manualTelemetryTimer = null;
    this.publishStatus(false);
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

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
