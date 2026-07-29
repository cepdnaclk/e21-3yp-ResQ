#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");

const simulatorPath = path.join(__dirname, "firmware-simulator.js");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mqtt = loadMqtt();
  const broker = spawn(options.mosquitto, ["-p", String(options.port), "-v"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const brokerOutput = [];
  broker.stdout.on("data", (chunk) => brokerOutput.push(chunk.toString()));
  broker.stderr.on("data", (chunk) => brokerOutput.push(chunk.toString()));

  let collector;
  let simulator;
  try {
    await waitForBroker(broker, brokerOutput, 5000);
    const rows = [];
    collector = mqtt.connect(`mqtt://127.0.0.1:${options.port}`, {
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 3000,
    });
    await onceConnected(collector);
    await subscribe(collector, "resq/#");
    collector.on("message", (topic, payload) => {
      rows.push({
        topic,
        payload: payload.toString("utf8"),
        bytes: Buffer.byteLength(payload),
      });
    });

    simulator = spawn(process.execPath, [
      simulatorPath,
      "--device-id", options.deviceId,
      "--mqtt-url", `mqtt://127.0.0.1:${options.port}`,
      "--heartbeat-interval-ms", String(options.heartbeatIntervalMs),
      "--exit-after-ms", String((options.seconds + 5) * 1000),
      "--quiet",
    ], {
      cwd: path.resolve(__dirname, "../.."),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const simulatorErrors = [];
    simulator.stderr.on("data", (chunk) => simulatorErrors.push(chunk.toString()));
    if (options.mode !== "idle") {
      await wait(750);
      await publishModeCommand(collector, options);
    }
    await wait(options.seconds * 1000);

    const result = {
      mode: options.mode,
      seconds: options.seconds,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      telemetryIntervalMs: options.telemetryIntervalMs,
      deviceId: options.deviceId,
      topics: metrics(rows, options.seconds),
      total: aggregateMetrics(rows, options.seconds),
      duplicateStatusCount: duplicateStatusCount(rows),
      capturedAt: new Date().toISOString(),
    };
    if (simulatorErrors.length > 0) {
      result.simulatorStderr = simulatorErrors.join("").trim();
    }
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), json, "utf8");
    }
    if (!options.noStdout) process.stdout.write(json);
  } finally {
    if (simulator && !simulator.killed) simulator.kill();
    if (collector) collector.end(true);
    if (!broker.killed) broker.kill();
  }
}

function publishModeCommand(client, options) {
  const requestId = `phase-05-${options.mode}`;
  let suffix;
  let payload;
  if (options.mode === "sensor-stream") {
    suffix = "cmd/telemetry";
    payload = {
      request_id: requestId,
      action: "START",
      interval_ms: options.telemetryIntervalMs,
    };
  } else if (options.mode === "calibration") {
    suffix = "cmd/calibration/start";
    payload = { request_id: requestId };
  } else if (options.mode === "session") {
    suffix = "cmd/session/start";
    payload = {
      request_id: requestId,
      session_id: options.sessionId,
      profile_id: "adult-basic",
    };
  } else {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    client.publish(
      `resq/${options.deviceId}/${suffix}`,
      JSON.stringify(payload),
      { qos: 1, retain: false },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

function metrics(rows, seconds) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.topic) || [];
    group.push(row);
    groups.set(row.topic, group);
  }
  return [...groups.entries()].map(([topic, group]) => {
    const totalBytes = group.reduce((sum, row) => sum + row.bytes, 0);
    return {
      topic,
      messages: group.length,
      messagesPerSecond: round(group.length / seconds),
      averagePayloadBytes: round(totalBytes / group.length),
      bytesPerSecond: round(totalBytes / seconds),
      bytesPerMinute: round((totalBytes * 60) / seconds),
      uniquePayloadCount: new Set(group.map((row) => row.payload)).size,
    };
  }).sort((left, right) => right.bytesPerSecond - left.bytesPerSecond);
}

function aggregateMetrics(rows, seconds) {
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  return {
    messages: rows.length,
    messagesPerSecond: round(rows.length / seconds),
    averagePayloadBytes: rows.length === 0 ? 0 : round(totalBytes / rows.length),
    bytesPerSecond: round(totalBytes / seconds),
    bytesPerMinute: round((totalBytes * 60) / seconds),
    uniquePayloadCount: new Set(rows.map((row) => `${row.topic}\u0000${row.payload}`)).size,
  };
}

function duplicateStatusCount(rows) {
  let duplicateCount = 0;
  let previous = null;
  for (const row of rows.filter((entry) => entry.topic.endsWith("/status"))) {
    const payload = JSON.parse(row.payload);
    delete payload.ts_ms;
    const effective = JSON.stringify(payload);
    if (effective === previous) duplicateCount += 1;
    previous = effective;
  }
  return duplicateCount;
}

function waitForBroker(processHandle, output, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (output.join("").includes("Opening ipv4 listen socket")) {
        clearInterval(timer);
        resolve();
      } else if (processHandle.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Mosquitto exited early: ${output.join("")}`));
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Mosquitto did not start: ${output.join("")}`));
      }
    }, 50);
  });
}

function onceConnected(client) {
  return new Promise((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
}

function subscribe(client, topic) {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function parseArgs(args) {
  const options = {
    mode: "idle",
    seconds: 60,
    port: 18884,
    deviceId: "M01",
    heartbeatIntervalMs: 5000,
    telemetryIntervalMs: 200,
    sessionId: "S-PHASE-05",
    mosquitto: process.env.MOSQUITTO_EXE ||
      "C:\\Program Files\\Mosquitto\\mosquitto.exe",
    output: "",
    noStdout: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => args[++index];
    if (arg === "--mode") {
      options.mode = value();
      if (!["idle", "sensor-stream", "calibration", "session"].includes(options.mode)) {
        throw new Error("--mode must be idle, sensor-stream, calibration, or session");
      }
    } else if (arg === "--seconds") options.seconds = positiveInteger(arg, value());
    else if (arg === "--port") options.port = positiveInteger(arg, value());
    else if (arg === "--device-id") options.deviceId = value();
    else if (arg === "--heartbeat-interval-ms") {
      options.heartbeatIntervalMs = positiveInteger(arg, value());
    } else if (arg === "--telemetry-interval-ms") {
      options.telemetryIntervalMs = positiveInteger(arg, value());
    } else if (arg === "--session-id") options.sessionId = value();
    else if (arg === "--mosquitto") options.mosquitto = value();
    else if (arg === "--output") options.output = value();
    else if (arg === "--no-stdout") options.noStdout = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function loadMqtt() {
  try {
    return require("mqtt");
  } catch {
    const desktopPackage = path.resolve(
      __dirname, "..", "..", "apps", "localhub-desktop", "package.json",
    );
    return createRequire(desktopPackage)("mqtt");
  }
}

function positiveInteger(flag, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return number;
}

function round(value) {
  return Number(value.toFixed(3));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
