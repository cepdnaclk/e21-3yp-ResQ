#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { createRequire } = require("node:module");
const {
  buildDeviceIds,
  evaluateTargets,
  parseTopic,
  payloadIdentityMismatch,
  percentile,
  scenarioPlan,
  summarizeLatency,
} = require("./phase7-load-core");
const {
  FirmwareSimulator,
  DEFAULTS: SIMULATOR_DEFAULTS,
} = require("../firmware-simulator/firmware-simulator");

const LOCALHUB_ROOT = path.resolve(__dirname, "..", "..");
const DESKTOP_PACKAGE = path.join(LOCALHUB_ROOT, "apps", "localhub-desktop", "package.json");
const MQTT = createRequire(DESKTOP_PACKAGE)("mqtt");
const DEFAULT_JAR = path.join(
  LOCALHUB_ROOT,
  "services",
  "hub-api",
  "target",
  "hub-api-0.1.1-SNAPSHOT.jar",
);
const DB_STATS_SCRIPT = path.join(__dirname, "phase7_db_stats.py");
const DB_AUDIT_SCRIPT = path.join(__dirname, "phase7_db_audit.py");
const SEED_ROSTER_SCRIPT = path.join(__dirname, "phase7_seed_roster.py");
const DEFAULT_ADMIN = Object.freeze({
  username: "phase7-admin",
  displayName: "Phase 7 Administrator",
  password: process.env.RESQ_PHASE7_ADMIN_PASSWORD || randomBytes(24).toString("base64url"),
});
const DEFAULT_INSTRUCTOR = Object.freeze({
  username: "phase7-instructor",
  displayName: "Phase 7 Instructor",
  password: process.env.RESQ_PHASE7_INSTRUCTOR_PASSWORD || randomBytes(24).toString("base64url"),
});
const ACCEPTANCE_TARGETS = Object.freeze({
  apiP95Ms: 300,
  sseP95Ms: 500,
  backendCpuPct: 70,
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const runId = options.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.resolve(options.outputDir || path.join(
    process.cwd(),
    "phase7-runs",
    runId,
  ));
  fs.mkdirSync(outputDir, { recursive: true });
  const progressPath = path.join(outputDir, "progress.log");
  const log = (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    fs.appendFileSync(progressPath, `${line}\n`);
    console.log(line);
  };

  const environment = new SelfHostedEnvironment({
    ...options,
    outputDir,
    log,
  });
  const observer = new MqttObserver(options.mqttUrl);
  const simulators = [];
  const sseClients = [];
  const resourceSamples = [];
  const recoveryEvents = [];
  let api;
  let databaseBefore;
  let databaseAudit;
  let scenarioStartedAt;
  let profile;
  let plan;
  let readinessEvidence = [];
  let probeTimer;
  let resourceTimer;
  let exitCode = 1;
  const expectedAssignments = new Map();

  const cleanup = async () => {
    clearInterval(probeTimer);
    clearInterval(resourceTimer);
    for (const client of sseClients) client.abort();
    for (const simulator of simulators) simulator.stop(0);
    await observer.stop();
    await environment.stop();
  };

  process.once("SIGINT", () => cleanup().finally(() => process.exit(130)));
  process.once("SIGTERM", () => cleanup().finally(() => process.exit(143)));

  try {
    log(`starting isolated Phase 7 environment run=${runId}`);
    await environment.start();
    api = new ApiClient(options.apiUrl);
    const deviceIds = buildDeviceIds(options.devices, options.devicePrefix);
    const instructor = await provisionInstructor(api, log);
    const roster = seedRoster(environment.databasePath, instructor.id, deviceIds.length);
    await observer.start();

    for (const deviceId of deviceIds) {
      const simulator = new FirmwareSimulator(MQTT, {
        ...SIMULATOR_DEFAULTS,
        deviceId,
        mqttUrl: options.mqttUrl,
        sessionId: `P7-${runId}-${deviceId}`,
        profileId: "adult-basic",
        telemetryIntervalMs: options.telemetryIntervalMs,
        heartbeatIntervalMs: 5000,
        exitAfterMs: 0,
        simulateError: false,
        simulateInterrupted: false,
        manageProcessLifecycle: false,
        quiet: true,
      });
      simulator.start();
      simulators.push(simulator);
    }

    await waitFor(
      () => deviceIds.every((deviceId) => observer.statusDevices.has(deviceId)),
      20_000,
      "all simulator retained statuses",
    );
    await waitFor(async () => {
      const response = await api.json("GET", "/api/hub/health", null, false);
      return response.status === 200 && response.body?.live_manikin_count === deviceIds.length;
    }, 30_000, "backend registration of every simulator", 250);
    log(`${deviceIds.length} simulators connected`);

    const profileResponse = await api.json("GET", "/api/firmware/calibration-profiles/default");
    requireStatus(profileResponse, [200], "load default profile");
    profile = profileResponse.body;
    await Promise.all(deviceIds.map((deviceId) => calibrateDevice(api, deviceId, profile)));
    await waitFor(
      async () => {
        readinessEvidence = await Promise.all(deviceIds.map(async (deviceId) => {
          const response = await api.json("GET", `/api/devices/${encodeURIComponent(deviceId)}/readiness`, null, false);
          return { requestedDeviceId: deviceId, status: response.status, ...response.body };
        }));
        return readinessEvidence.every((readiness) => (
          readiness.status === 200
          && readiness.deviceId === readiness.requestedDeviceId
          && readiness.readyForSession === true
          && Number.isInteger(readiness.calibrationSchemaVersion)
          && readiness.calibrationSchemaVersion >= 1
          && readiness.calibrationSchemaVersion <= 3
          && Number.isInteger(readiness.calibrationGeneration)
          && readiness.calibrationGeneration > 0
          && readiness.calibrationStorageStatus === "VALID"
          && readiness.recalibrationRequired === false
          && readiness.profileVersion === profile.version
          && readiness.profileHash === profile.profileHash
        ));
      },
      Math.max(30_000, deviceIds.length * 5_000),
      "strict readiness for every simulator",
      350,
    );
    log("strict calibration identity accepted for every simulator");

    databaseBefore = readDatabaseStats(environment.databasePath);
    api.resetMeasurements();
    observer.resetMeasurements();
    scenarioStartedAt = Date.now();

    for (let index = 0; index < options.sseClients; index += 1) {
      const client = startSseClient(
        `${options.apiUrl}/api/stream/manikins/live`,
        api.token,
        deviceIds,
      );
      sseClients.push(client);
    }
    await waitFor(
      () => sseClients.every((client) => client.connected || client.error),
      10_000,
      "SSE clients to connect",
    );
    if (sseClients.some((client) => client.error)) {
      throw new Error(`SSE connection failed: ${sseClients.find((client) => client.error).error}`);
    }

    plan = scenarioPlan(deviceIds, options.scenario);
    const activeSessions = new Map();
    await enterScenario(api, simulators, plan, activeSessions, expectedAssignments, options, roster, log);

    resourceSamples.push(sampleResources(environment));
    resourceTimer = setInterval(() => {
      resourceSamples.push(sampleResources(environment));
    }, options.resourceSampleIntervalMs);
    probeTimer = setInterval(() => {
      probeRest(api, deviceIds).catch((error) => log(`REST probe error: ${error.message}`));
    }, options.restProbeIntervalMs);

    log(`scenario=${options.scenario} devices=${options.devices} duration=${options.durationSeconds}s`);
    await runScenarioBody({
      api,
      simulators,
      plan,
      options,
      log,
      environment,
      sseClients,
      deviceIds,
      recoveryEvents,
    });

    clearInterval(probeTimer);
    clearInterval(resourceTimer);
    await leaveScenario(api, plan, activeSessions, log);
    await delay(1500);

    const scenarioEndedAt = Date.now();
    for (const client of sseClients) client.abort();
    let healthAfter;
    try {
      await waitFor(async () => {
        healthAfter = await api.json("GET", "/api/hub/health", null, false);
        return healthAfter.body?.active_sse_emitters === 0;
      }, 12_000, "SSE emitter cleanup", 250);
    } catch (error) {
      log(`SSE emitter cleanup remained incomplete: ${error.message}`);
      healthAfter = await api.json("GET", "/api/hub/health", null, false);
    }
    const sessionsAfter = await api.json("GET", "/api/sessions", null, false);
    const databaseAfter = readDatabaseStats(environment.databasePath);
    databaseAudit = readDatabaseAudit(
      environment.databasePath,
      deviceIds,
      [...plan.sensorStream, ...plan.idle],
      profile,
    );
    const result = buildResult({
      runId,
      options,
      environment,
      observer,
      api,
      sseClients,
      resourceSamples,
      databaseBefore,
      databaseAfter,
      databaseAudit,
      healthAfter,
      sessionsAfter,
      scenarioStartedAt,
      scenarioEndedAt,
      activeSessions,
      expectedAssignments,
      profile,
      readinessEvidence,
      recoveryEvents,
    });
    result.acceptance = evaluateTargets(result, ACCEPTANCE_TARGETS);
    const resultPath = path.join(outputDir, "result.json");
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    log(`result=${resultPath}`);
    log(`acceptance=${result.acceptance.passed ? "PASS" : "FAIL"}`);
    if (!result.acceptance.passed) {
      for (const failure of result.acceptance.failures) log(`acceptance failure: ${failure}`);
    }
    exitCode = result.acceptance.passed ? 0 : 2;
  } catch (error) {
    const failure = {
      runId,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.stack || error.message : String(error),
      strictProfile: profile ? {
        profileId: profile.profileId,
        version: profile.version,
        profileHash: profile.profileHash,
      } : null,
      lastReadinessEvidence: readinessEvidence,
    };
    fs.writeFileSync(path.join(outputDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`);
    log(`FAILED ${failure.error}`);
  } finally {
    await cleanup();
  }
  process.exitCode = exitCode;
}

class SelfHostedEnvironment {
  constructor(options) {
    this.options = options;
    this.log = options.log;
    this.outputDir = options.outputDir;
    this.databasePath = path.join(this.outputDir, "phase7.sqlite");
    this.broker = null;
    this.backend = null;
  }

  async start() {
    if (!fs.existsSync(this.options.jarPath)) {
      throw new Error(`backend jar not found: ${this.options.jarPath}`);
    }
    await this.startBroker();
    await this.startBackend();
  }

  async startBroker() {
    const configPath = path.join(this.outputDir, "mosquitto.conf");
    fs.writeFileSync(configPath, [
      `listener ${this.options.mqttPort} 127.0.0.1`,
      "allow_anonymous true",
      "persistence false",
      "connection_messages true",
      "log_type all",
      "log_dest stdout",
      "",
    ].join("\n"));
    this.broker = spawn(
      this.options.mosquittoPath,
      ["-c", configPath, "-v"],
      processOptions(this.outputDir, "broker"),
    );
    await waitFor(
      () => isProcessRunning(this.broker),
      5_000,
      "isolated MQTT broker process",
    );
    await delay(350);
    this.log(`broker pid=${this.broker.pid} port=${this.options.mqttPort}`);
  }

  async startBackend() {
    const env = {
      ...process.env,
      HUB_API_PORT: String(this.options.apiPort),
      RESQ_SQLITE_PATH: this.databasePath,
      RESQ_MQTT_BROKER_URL: `tcp://127.0.0.1:${this.options.mqttPort}`,
      RESQ_MQTT_ADVERTISED_HOST: "127.0.0.1",
      RESQ_MQTT_PORT: String(this.options.mqttPort),
      RESQ_MQTT_CLIENT_ID: `phase7-subscriber-${this.options.apiPort}`,
      RESQ_MQTT_COMMAND_CLIENT_ID: `phase7-commands-${this.options.apiPort}`,
      RESQ_CLOUD_SYNC_ENABLED: "false",
      RESQ_ROSTER_SYNC_ENABLED: "false",
    };
    this.backend = spawn(
      this.options.javaPath,
      ["-jar", this.options.jarPath],
      { ...processOptions(this.outputDir, "backend"), env },
    );
    await waitFor(async () => {
      try {
        const response = await fetch(`${this.options.apiUrl}/api/hub/health`);
        const body = await response.json();
        return response.ok && body.mqtt_connected === true;
      } catch {
        return false;
      }
    }, 30_000, "backend health and MQTT connection", 300);
    this.log(`backend pid=${this.backend.pid} port=${this.options.apiPort}`);
  }

  async restartBroker() {
    await stopChild(this.broker);
    this.broker = null;
    await delay(1000);
    await this.startBroker();
  }

  async restartBackend() {
    await stopChild(this.backend);
    this.backend = null;
    await delay(1000);
    await this.startBackend();
  }

  async stop() {
    await stopChild(this.backend);
    await stopChild(this.broker);
    this.backend = null;
    this.broker = null;
  }
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = null;
    this.resetMeasurements();
  }

  resetMeasurements() {
    this.measurements = [];
    this.rawPayloadViolations = [];
  }

  async json(method, endpoint, body = null, record = true) {
    const startedAt = performance.now();
    const headers = { Accept: "application/json" };
    if (body != null) headers["Content-Type"] = "application/json";
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let response;
    let parsed;
    try {
      response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      parsed = text ? safeJson(text) : null;
      if (isOrdinaryApiEndpoint(method, endpoint)) {
        this.rawPayloadViolations.push(...findForbiddenPayloadFields(parsed).map((field) => ({
          endpoint: normalizeEndpoint(endpoint),
          field,
        })));
      }
      return {
        status: response.status,
        body: parsed,
        latencyMs: performance.now() - startedAt,
      };
    } finally {
      if (record) {
        this.measurements.push({
          method,
          endpoint: normalizeEndpoint(endpoint),
          status: response?.status ?? 0,
          latencyMs: performance.now() - startedAt,
        });
      }
    }
  }
}

class MqttObserver {
  constructor(url) {
    this.url = url;
    this.client = null;
    this.statusDevices = new Set();
    this.resetMeasurements();
  }

  resetMeasurements() {
    this.startedAt = Date.now();
    this.messages = 0;
    this.bytes = 0;
    this.bySuffix = new Map();
    this.commandSentAt = new Map();
    this.commandReplies = new Set();
    this.commandLatencies = [];
    this.crossDeviceUpdates = 0;
    this.duplicateSessionStarts = 0;
    this.sessionStarts = new Set();
    this.lastMessageAtByDevice = new Map();
  }

  async start() {
    this.client = MQTT.connect(this.url, {
      clientId: `phase7-observer-${Date.now().toString(36)}`,
      clean: true,
      reconnectPeriod: 500,
      connectTimeout: 3000,
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MQTT observer connection timeout")), 5000);
      this.client.once("connect", () => {
        clearTimeout(timeout);
        this.client.subscribe("resq/#", { qos: 1 }, (error) => error ? reject(error) : resolve());
      });
      this.client.once("error", reject);
    });
    this.client.on("message", (topic, payloadBuffer) => this.record(topic, payloadBuffer));
  }

  record(topic, payloadBuffer) {
    const parsedTopic = parseTopic(topic);
    if (!parsedTopic) return;
    const payload = safeJson(payloadBuffer.toString("utf8"));
    this.lastMessageAtByDevice.set(parsedTopic.deviceId, Date.now());
    this.messages += 1;
    this.bytes += Buffer.byteLength(topic) + payloadBuffer.length;
    const bucket = this.bySuffix.get(parsedTopic.suffix) || { messages: 0, bytes: 0 };
    bucket.messages += 1;
    bucket.bytes += payloadBuffer.length;
    this.bySuffix.set(parsedTopic.suffix, bucket);
    if (parsedTopic.suffix === "status") this.statusDevices.add(parsedTopic.deviceId);
    if (payloadIdentityMismatch(parsedTopic.deviceId, payload)) this.crossDeviceUpdates += 1;

    if (parsedTopic.suffix.startsWith("cmd/") && typeof payload?.request_id === "string") {
      this.commandSentAt.set(payload.request_id, performance.now());
    }
    if (
      (parsedTopic.suffix === "events" || parsedTopic.suffix.startsWith("events/"))
      && typeof payload?.reply_id === "string"
      && this.commandSentAt.has(payload.reply_id)
    ) {
      if (!this.commandReplies.has(payload.reply_id)) {
        this.commandReplies.add(payload.reply_id);
        this.commandLatencies.push(performance.now() - this.commandSentAt.get(payload.reply_id));
      }
      if (payload.event_id === 2000 && payload.session_id) {
        const key = `${parsedTopic.deviceId}\u0000${payload.session_id}`;
        if (this.sessionStarts.has(key)) this.duplicateSessionStarts += 1;
        this.sessionStarts.add(key);
      }
    }
  }

  async stop() {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    await new Promise((resolve) => client.end(true, resolve));
  }
}

async function provisionInstructor(api, log) {
  const bootstrap = await api.json("GET", "/api/auth/bootstrap", null, false);
  requireStatus(bootstrap, [200], "auth bootstrap");
  if (bootstrap.body?.firstRunRequired) {
    const setup = await api.json("POST", "/api/auth/setup", DEFAULT_ADMIN, false);
    requireStatus(setup, [200], "first admin setup");
    api.token = setup.body.token;
    const created = await api.json("POST", "/api/auth/users", {
      ...DEFAULT_INSTRUCTOR,
      role: "INSTRUCTOR",
    }, false);
    requireStatus(created, [201], "scale instructor creation");
    log("created isolated scale administrator and instructor");
  } else {
    const adminLogin = await api.json("POST", "/api/auth/login", {
      username: DEFAULT_ADMIN.username,
      password: DEFAULT_ADMIN.password,
    }, false);
    requireStatus(adminLogin, [200], "scale admin login");
    api.token = adminLogin.body.token;
  }
  const instructorLogin = await api.json("POST", "/api/auth/login", {
    username: DEFAULT_INSTRUCTOR.username,
    password: DEFAULT_INSTRUCTOR.password,
  }, false);
  requireStatus(instructorLogin, [200], "scale instructor login");
  api.token = instructorLogin.body.token;
  return instructorLogin.body.user;
}

async function calibrateDevice(api, deviceId, profile) {
  const response = await api.json(
    "POST",
    `/api/devices/${encodeURIComponent(deviceId)}/calibration/start`,
    {
      hall_delta: profile.hallDelta,
      ref_pressure: profile.refPressure,
      bladder_1_pressure: profile.bladder1Pressure,
      bladder_2_pressure: profile.bladder2Pressure,
      profile_id: profile.profileId,
      sample_interval_ms: 20,
      calibration_window_ms: 3000,
    },
    false,
  );
  requireStatus(response, [202], `start calibration for ${deviceId}`);
}

async function enterScenario(api, simulators, plan, activeSessions, expectedAssignments, options, roster, log) {
  for (let index = 0; index < plan.active.length; index += 1) {
    const deviceId = plan.active[index];
    const response = await api.json("POST", "/api/sessions/start", {
      deviceId,
      traineeId: roster.traineeIds[index],
      courseId: roster.courseId,
      traineeRecordId: null,
      quickTrainee: null,
      guestLabel: `Scale Guest ${deviceId}`,
      profileId: "adult-basic",
      scenario: `Phase 7 ${options.scenario}`,
      notes: "Deterministic Phase 7 load harness",
    });
    requireStatus(response, [200], `start session for ${deviceId}`);
    activeSessions.set(deviceId, response.body.sessionId);
    expectedAssignments.set(deviceId, {
      sessionId: response.body.sessionId,
      traineeId: roster.traineeIds[index],
      courseId: roster.courseId,
    });
  }
  for (const deviceId of plan.sensorStream) {
    const response = await api.json(
      "POST",
      `/api/devices/${encodeURIComponent(deviceId)}/telemetry/start`,
      { interval_ms: options.telemetryIntervalMs },
    );
    requireStatus(response, [202], `start sensor stream for ${deviceId}`);
  }
  if (plan.active.length || plan.sensorStream.length) {
    await delay(1200);
  }
  log(`state active=${plan.active.length} sensorStream=${plan.sensorStream.length} idle=${plan.idle.length}`);
}

async function runScenarioBody(context) {
  const {
    api,
    simulators,
    plan,
    options,
    log,
    environment,
    sseClients,
    deviceIds,
    recoveryEvents,
  } = context;
  const deadline = Date.now() + options.durationSeconds * 1000;
  if (options.scenario === "command-burst") {
    let round = 0;
    while (Date.now() < deadline) {
      round += 1;
      await Promise.all(plan.idle.map(async (deviceId) => {
        const response = await api.json("POST", `/api/devices/${encodeURIComponent(deviceId)}/firmware/debug`);
        requireStatus(response, [200], `debug command for ${deviceId}`);
      }));
      log(`command burst round=${round}`);
      await delay(Math.min(options.commandBurstIntervalMs, Math.max(0, deadline - Date.now())));
    }
    return;
  }

  if (options.scenario === "reconnect") {
    let cycle = 0;
    while (Date.now() < deadline) {
      cycle += 1;
      for (const simulator of simulators) {
        if (simulator.client?.stream) simulator.client.stream.destroy();
      }
      log(`forced simulator transport reconnect cycle=${cycle}`);
      await delay(Math.min(10_000, Math.max(0, deadline - Date.now())));
    }
    return;
  }

  if (options.scenario === "soak") {
    const startedAt = Date.now();
    const backendRestartAt = startedAt + Math.floor(options.durationSeconds * 1000 / 3);
    const brokerRestartAt = startedAt + Math.floor(options.durationSeconds * 2000 / 3);
    let backendRestarted = false;
    let brokerRestarted = false;
    while (Date.now() < deadline) {
      if (!backendRestarted && Date.now() >= backendRestartAt) {
        backendRestarted = true;
        for (const client of sseClients) client.abort();
        const recoveryStartedAt = Date.now();
        await environment.restartBackend();
        await waitFor(async () => {
          const response = await api.json("GET", "/api/hub/health", null, false);
          return response.status === 200
            && response.body?.mqtt_connected === true
            && response.body?.live_manikin_count === deviceIds.length;
        }, 45_000, "backend recovery with all retained devices", 400);
        for (let index = 0; index < options.sseClients; index += 1) {
          const client = startSseClient(
            `${options.apiUrl}/api/stream/manikins/live`,
            api.token,
            deviceIds,
          );
          sseClients.push(client);
        }
        await waitFor(
          () => sseClients.slice(-options.sseClients).every((client) => client.connected || client.error),
          10_000,
          "post-backend-restart SSE clients",
        );
        recoveryEvents.push({
          component: "backend",
          startedAt: new Date(recoveryStartedAt).toISOString(),
          recoveredAt: new Date().toISOString(),
          recoveryMs: Date.now() - recoveryStartedAt,
        });
        log(`backend recovery completed in ${Date.now() - recoveryStartedAt}ms`);
      }
      if (!brokerRestarted && Date.now() >= brokerRestartAt) {
        brokerRestarted = true;
        const recoveryStartedAt = Date.now();
        await environment.restartBroker();
        await waitFor(async () => {
          const response = await api.json("GET", "/api/hub/health", null, false);
          return response.status === 200 && response.body?.mqtt_connected === true;
        }, 45_000, "backend MQTT recovery after broker restart", 400);
        await waitFor(
          () => deviceIds.every((deviceId) => {
            return context.simulators.find((simulator) => simulator.options.deviceId === deviceId)?.client?.connected;
          }),
          30_000,
          "all simulators after broker restart",
          400,
        );
        recoveryEvents.push({
          component: "broker",
          startedAt: new Date(recoveryStartedAt).toISOString(),
          recoveredAt: new Date().toISOString(),
          recoveryMs: Date.now() - recoveryStartedAt,
        });
        log(`broker recovery completed in ${Date.now() - recoveryStartedAt}ms`);
      }
      await delay(Math.min(1000, deadline - Date.now()));
    }
    return;
  }

  while (Date.now() < deadline) {
    await delay(Math.min(1000, deadline - Date.now()));
  }
}

async function leaveScenario(api, plan, activeSessions, log) {
  for (const deviceId of plan.sensorStream) {
    const response = await api.json("POST", `/api/devices/${encodeURIComponent(deviceId)}/telemetry/stop`);
    requireStatus(response, [202], `stop sensor stream for ${deviceId}`);
  }
  for (const [deviceId, sessionId] of activeSessions) {
    const response = await api.json("POST", "/api/sessions/end", { sessionId });
    requireStatus(response, [200], `stop session for ${deviceId}`);
  }
  if (activeSessions.size) await delay(1200);
  log("scenario cleanup completed");
}

async function probeRest(api, deviceIds) {
  await api.json("GET", "/api/manikins/live");
  await api.json("GET", "/api/hub/health");
  const index = Math.floor(Date.now() / 1000) % deviceIds.length;
  await api.json("GET", `/api/manikins/live/${encodeURIComponent(deviceIds[index])}`);
}

function startSseClient(url, token, expectedDeviceIds) {
  const controller = new AbortController();
  const client = {
    connected: false,
    aborted: false,
    error: null,
    events: 0,
    bytes: 0,
    deviceSets: [],
    observations: [],
    latencies: [],
    rawPayloadViolations: [],
    lastSeenByDevice: new Map(),
    abort: () => {
      client.aborted = true;
      controller.abort();
    },
  };
  (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      client.connected = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        client.bytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block.split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data) continue;
          const payload = safeJson(data);
          if (!Array.isArray(payload)) continue;
          client.rawPayloadViolations.push(...findForbiddenPayloadFields(payload));
          client.events += 1;
          client.deviceSets.push(payload.map((entry) => entry.deviceId).sort());
          for (const entry of payload) {
            client.observations.push({
              deviceId: entry.deviceId,
              at: Date.now(),
              online: entry.online,
              stale: entry.stale,
              offline: entry.offline,
              lastSeen: entry.lastSeen,
            });
            const receivedAt = Date.parse(entry.lastSeen);
            const previousLastSeen = client.lastSeenByDevice.get(entry.deviceId);
            client.lastSeenByDevice.set(entry.deviceId, entry.lastSeen);
            if (
              previousLastSeen != null
              && previousLastSeen !== entry.lastSeen
              && Number.isFinite(receivedAt)
            ) {
              client.latencies.push(Math.max(0, Date.now() - receivedAt));
            }
          }
          const unexpected = payload.filter((entry) => !expectedDeviceIds.includes(entry.deviceId));
          if (unexpected.length) {
            client.error = `unexpected SSE device IDs: ${unexpected.map((entry) => entry.deviceId).join(",")}`;
          }
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") client.error = error.message || String(error);
    }
  })();
  return client;
}

function buildResult(context) {
  const durationSeconds = (context.scenarioEndedAt - context.scenarioStartedAt) / 1000;
  const byEndpoint = {};
  for (const measurement of context.api.measurements) {
    const key = `${measurement.method} ${measurement.endpoint}`;
    (byEndpoint[key] ||= []).push(measurement.latencyMs);
  }
  const restAll = context.api.measurements.map((entry) => entry.latencyMs);
  const sseLatencies = context.sseClients.flatMap((client) => client.latencies);
  const missingReplies = [...context.observer.commandSentAt.keys()]
    .filter((requestId) => !context.observer.commandReplies.has(requestId));
  const databaseRowsBefore = sumRows(context.databaseBefore?.tables);
  const databaseRowsAfter = sumRows(context.databaseAfter?.tables);
  const sessionBodies = Array.isArray(context.sessionsAfter.body) ? context.sessionsAfter.body : [];
  let summaryMismatches = 0;
  let crossDeviceAssignments = 0;
  for (const [deviceId, sessionId] of context.activeSessions) {
    const summary = sessionBodies.find((entry) => entry.sessionId === sessionId);
    if (
      !summary
      || summary.deviceId !== deviceId
      || (summary.summary?.totalCompressions ?? 0) < 1
    ) {
      summaryMismatches += 1;
    }
    const expected = context.expectedAssignments.get(deviceId);
    if (
      !summary
      || summary.deviceId !== deviceId
      || summary.traineeId !== expected?.traineeId
      || summary.courseId !== expected?.courseId
    ) {
      crossDeviceAssignments += 1;
    }
  }
  const duplicateSessionRows = [...context.activeSessions.keys()]
    .map((deviceId) => sessionBodies.filter((entry) => entry.deviceId === deviceId).length)
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count - 1, 0);
  const staleCounts = context.sseClients
    .flatMap((client) => client.observations)
    .filter((observation) => {
      if (!observation.stale && !observation.offline) return false;
      const brokerSeenAt = context.observer.lastMessageAtByDevice.get(observation.deviceId);
      return Number.isFinite(brokerSeenAt) && observation.at - brokerSeenAt < 12_000;
    })
    .length;
  const crashes = Number(!isProcessRunning(context.environment.backend))
    + Number(!isProcessRunning(context.environment.broker));
  const resources = summarizeResources(context.resourceSamples);
  const rawPayloadViolations = context.api.rawPayloadViolations.length
    + context.sseClients.reduce((sum, client) => sum + client.rawPayloadViolations.length, 0);
  return {
    schemaVersion: 1,
    runId: context.runId,
    generatedAt: new Date().toISOString(),
    configuration: {
      devices: context.options.devices,
      scenario: context.options.scenario,
      requestedDurationSeconds: context.options.durationSeconds,
      measuredDurationSeconds: Number(durationSeconds.toFixed(3)),
      telemetryIntervalMs: context.options.telemetryIntervalMs,
      sseClients: context.options.sseClients,
      apiUrl: context.options.apiUrl,
      mqttUrl: context.options.mqttUrl,
    },
    mqtt: {
      messages: context.observer.messages,
      bytes: context.observer.bytes,
      messagesPerSecond: Number((context.observer.messages / durationSeconds).toFixed(3)),
      bytesPerSecond: Number((context.observer.bytes / durationSeconds).toFixed(3)),
      bySuffix: Object.fromEntries([...context.observer.bySuffix.entries()].sort()),
      commandLatency: summarizeLatency(context.observer.commandLatencies),
      commandCount: context.observer.commandSentAt.size,
      replyCount: context.observer.commandReplies.size,
    },
    rest: {
      overall: summarizeLatency(restAll),
      endpoints: Object.fromEntries(
        Object.entries(byEndpoint).map(([endpoint, values]) => [endpoint, summarizeLatency(values)]),
      ),
      statuses: countBy(context.api.measurements, (entry) => String(entry.status)),
    },
    sse: {
      clientCount: context.sseClients.length,
      connectedClients: context.sseClients.filter((client) => client.connected).length,
      abortedClients: context.sseClients.filter((client) => client.aborted).length,
      events: context.sseClients.reduce((sum, client) => sum + client.events, 0),
      bytes: context.sseClients.reduce((sum, client) => sum + client.bytes, 0),
      visibleUpdateLatency: summarizeLatency(sseLatencies),
      clientErrors: context.sseClients.map((client) => client.error).filter(Boolean),
      rawPayloadViolations: context.sseClients.flatMap((client) => client.rawPayloadViolations),
      server: {
        activeEmittersAfterDisconnect: context.healthAfter.body?.active_sse_emitters ?? null,
        fanoutQueueDepthAfterDisconnect: context.healthAfter.body?.sse_fanout_queue_depth ?? null,
        droppedFanoutTasks: context.healthAfter.body?.sse_fanout_dropped_tasks ?? null,
      },
    },
    resources,
    storage: {
      before: context.databaseBefore,
      after: context.databaseAfter,
      growthBytes: (context.databaseAfter?.bytes || 0) - (context.databaseBefore?.bytes || 0),
      rowGrowth: databaseRowsAfter - databaseRowsBefore,
      writesPerSecond: Number(((databaseRowsAfter - databaseRowsBefore) / durationSeconds).toFixed(3)),
      identityAudit: context.databaseAudit,
    },
    identity: {
      expectedProfileId: context.profile?.profileId,
      expectedProfileVersion: context.profile?.version,
      expectedProfileHash: context.profile?.profileHash,
      readiness: context.readinessEvidence,
    },
    recovery: {
      events: context.recoveryEvents,
      backendRestartCount: context.recoveryEvents.filter((entry) => entry.component === "backend").length,
      brokerRestartCount: context.recoveryEvents.filter((entry) => entry.component === "broker").length,
    },
    invariants: {
      crashes,
      crossDeviceUpdates: context.observer.crossDeviceUpdates + crossDeviceAssignments,
      crossDeviceAssignments,
      missingCommandReplies: missingReplies.length,
      missingReplyIds: missingReplies,
      duplicateSessions: context.observer.duplicateSessionStarts + duplicateSessionRows,
      duplicateSessionRows,
      falseStaleTransitions: staleCounts,
      summaryMismatches,
      emitterLeak: Number.isInteger(context.healthAfter.body?.active_sse_emitters)
        ? context.healthAfter.body.active_sse_emitters
        : null,
      invalidIdentityPersistence:
        context.databaseAudit.unexpectedDeviceRows
        + context.databaseAudit.invalidProfileIdentityRows,
      identityRowsAudited: context.databaseAudit.profileRowsAudited,
      rawPayloadInOrdinaryApi: rawPayloadViolations,
      ordinaryApiRawPayloadViolations: context.api.rawPayloadViolations,
      diagnosticScoring: context.databaseAudit.diagnosticScoringRows,
      continuousMemoryGrowthTrend: resources.backend.continuousGrowthTrend,
    },
    healthAfter: context.healthAfter.body,
  };
}

function sampleResources(environment) {
  return {
    at: Date.now(),
    backend: readProcess(environment.backend?.pid),
    broker: readProcess(environment.broker?.pid),
  };
}

function readProcess(pid) {
  if (!Number.isInteger(pid)) return null;
  const command = `$process = Get-Process -Id ${pid} -ErrorAction Stop; `
    + "[pscustomobject]@{"
    + "cpuSeconds=$process.CPU;"
    + "workingSetBytes=$process.WorkingSet64;"
    + "privateBytes=$process.PrivateMemorySize64;"
    + "handles=$process.HandleCount;"
    + "threads=$process.Threads.Count"
    + "} | ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? safeJson(result.stdout.trim()) : null;
}

function summarizeResources(samples) {
  const cores = Math.max(1, os.cpus().length);
  const summarize = (key) => {
    const points = samples
      .map((sample) => ({ at: sample.at, value: sample[key] }))
      .filter((point) => point.value);
    const cpu = [];
    for (let index = 1; index < points.length; index += 1) {
      const elapsed = (points[index].at - points[index - 1].at) / 1000;
      const used = points[index].value.cpuSeconds - points[index - 1].value.cpuSeconds;
      if (elapsed > 0 && used >= 0) cpu.push((used / elapsed / cores) * 100);
    }
    const memory = points.map((point) => point.value.workingSetBytes);
    const privateBytes = points.map((point) => point.value.privateBytes);
    const handles = points.map((point) => point.value.handles);
    const threads = points.map((point) => point.value.threads);
    return {
      samples: points.length,
      cpuPct: {
        p50: percentile(cpu, 0.50),
        p95: percentile(cpu, 0.95),
        max: cpu.length ? Number(Math.max(...cpu).toFixed(3)) : null,
      },
      workingSetBytes: rangeSummary(memory),
      privateBytes: rangeSummary(privateBytes),
      handles: rangeSummary(handles),
      threads: rangeSummary(threads),
      continuousGrowthTrend: continuousGrowthTrend(memory),
    };
  };
  return { backend: summarize("backend"), broker: summarize("broker") };
}

function readDatabaseStats(databasePath) {
  const result = spawnSync("python", [DB_STATS_SCRIPT, databasePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { error: result.stderr.trim(), exists: fs.existsSync(databasePath) };
  }
  return safeJson(result.stdout.trim());
}

function readDatabaseAudit(databasePath, expectedDeviceIds, nonScoringDeviceIds, profile) {
  if (
    typeof profile?.profileId !== "string"
    || !Number.isInteger(profile?.version)
    || typeof profile?.profileHash !== "string"
  ) {
    throw new Error("default calibration profile is missing strict identity fields");
  }
  const result = spawnSync("python", [
    DB_AUDIT_SCRIPT,
    databasePath,
    "--expected-devices",
    expectedDeviceIds.join(","),
    "--non-scoring-devices",
    nonScoringDeviceIds.join(","),
    "--profile-id",
    profile.profileId,
    "--profile-version",
    String(profile.version),
    "--profile-hash",
    profile.profileHash,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`database identity/scoring audit failed: ${result.stderr.trim()}`);
  }
  const parsed = safeJson(result.stdout.trim());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("database identity/scoring audit returned an invalid result");
  }
  return parsed;
}

function seedRoster(databasePath, instructorId, traineeCount) {
  const result = spawnSync(
    "python",
    [SEED_ROSTER_SCRIPT, databasePath, instructorId, String(traineeCount)],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`failed to seed scale roster: ${result.stderr.trim()}`);
  }
  return safeJson(result.stdout.trim());
}

function processOptions(outputDir, label) {
  const stdout = fs.openSync(path.join(outputDir, `${label}.log`), "a");
  const stderr = fs.openSync(path.join(outputDir, `${label}.error.log`), "a");
  return {
    cwd: outputDir,
    windowsHide: true,
    detached: false,
    stdio: ["ignore", stdout, stderr],
  };
}

async function stopChild(child) {
  if (!child || !isProcessRunning(child)) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
  if (isProcessRunning(child)) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

function isProcessRunning(child) {
  return Boolean(child && child.pid && child.exitCode == null && !child.killed);
}

function rangeSummary(values) {
  const finite = values.filter(Number.isFinite);
  return {
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
    delta: finite.length ? finite.at(-1) - finite[0] : null,
    p95: percentile(finite, 0.95),
  };
}

function continuousGrowthTrend(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 4) return null;
  const window = finite.slice(-Math.min(6, finite.length));
  let increases = 0;
  for (let index = 1; index < window.length; index += 1) {
    if (window[index] > window[index - 1]) increases += 1;
  }
  const growthBytes = window.at(-1) - window[0];
  return increases === window.length - 1 && growthBytes >= 5 * 1024 * 1024 ? 1 : 0;
}

function sumRows(tables) {
  if (!tables || typeof tables !== "object") return 0;
  return Object.values(tables).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
}

function countBy(values, keyFn) {
  const result = {};
  for (const value of values) {
    const key = keyFn(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function normalizeEndpoint(endpoint) {
  return endpoint
    .replace(/\/SCALE-\d{3}/g, "/{deviceId}")
    .replace(/\/P7-\d{3}/g, "/{deviceId}");
}

function requireStatus(response, allowed, action) {
  if (!allowed.includes(response.status)) {
    throw new Error(`${action} failed HTTP ${response.status}: ${JSON.stringify(response.body)}`);
  }
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isOrdinaryApiEndpoint(method, endpoint) {
  const pathOnly = String(endpoint || "").split("?")[0];
  return (
    (method === "GET" && pathOnly === "/api/hub/health")
    || pathOnly.startsWith("/api/manikins/live")
    || pathOnly === "/api/sessions"
    || pathOnly.startsWith("/api/sessions/")
  );
}

function findForbiddenPayloadFields(payload) {
  const forbidden = new Set(["debugraw", "rawpayload", "payloadjson"]);
  const violations = [];
  const visit = (value, location) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[_-]/g, "").toLowerCase();
      const childLocation = location ? `${location}.${key}` : key;
      if (forbidden.has(normalized)) violations.push(childLocation);
      visit(child, childLocation);
    }
  };
  visit(payload, "");
  return violations;
}

function parseArgs(args) {
  const options = {
    help: false,
    devices: 1,
    scenario: "idle",
    durationSeconds: 10,
    telemetryIntervalMs: 200,
    sseClients: 1,
    restProbeIntervalMs: 1000,
    resourceSampleIntervalMs: 2000,
    commandBurstIntervalMs: 1000,
    devicePrefix: "SCALE",
    runId: null,
    outputDir: null,
    mqttPort: 18884,
    apiPort: 18081,
    mqttUrl: "mqtt://127.0.0.1:18884",
    apiUrl: "http://127.0.0.1:18081",
    jarPath: DEFAULT_JAR,
    mosquittoPath: process.env.RESQ_PHASE7_MOSQUITTO || "mosquitto",
    javaPath: process.env.RESQ_PHASE7_JAVA || "java",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = () => {
      const next = args[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--devices":
        options.devices = integer(arg, value(), 1, 200);
        break;
      case "--scenario":
        options.scenario = value();
        if (!["idle", "session", "mixed", "command-burst", "reconnect", "soak"].includes(options.scenario)) {
          throw new Error("scenario must be idle, session, mixed, command-burst, reconnect, or soak");
        }
        break;
      case "--duration-seconds":
        options.durationSeconds = integer(arg, value(), 1, 86_400);
        break;
      case "--telemetry-interval-ms":
        options.telemetryIntervalMs = integer(arg, value(), 100, 1000);
        break;
      case "--sse-clients":
        options.sseClients = integer(arg, value(), 1, 100);
        break;
      case "--output-dir":
        options.outputDir = value();
        break;
      case "--run-id":
        options.runId = value();
        break;
      case "--device-prefix":
        options.devicePrefix = value();
        break;
      case "--mqtt-port":
        options.mqttPort = integer(arg, value(), 1024, 65535);
        options.mqttUrl = `mqtt://127.0.0.1:${options.mqttPort}`;
        break;
      case "--api-port":
        options.apiPort = integer(arg, value(), 1024, 65535);
        options.apiUrl = `http://127.0.0.1:${options.apiPort}`;
        break;
      case "--jar":
        options.jarPath = path.resolve(value());
        break;
      case "--mosquitto":
        options.mosquittoPath = value();
        break;
      case "--java":
        options.javaPath = value();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function integer(flag, value, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`ResQ Phase 7 deterministic multi-manikin load harness

Usage:
  node phase7-load-harness.js --devices <1|5|10|20> --scenario <name> --duration-seconds <n>

Scenarios:
  idle, session, mixed, command-burst, reconnect, soak

The harness starts an isolated broker and backend on ports 18884 and 18081,
creates a temporary SQLite database, provisions a test instructor, calibrates
deterministic simulator IDs, opens authenticated SSE clients, and writes
progress.log plus result.json beneath --output-dir.
`);
}

module.exports = {
  ApiClient,
  MqttObserver,
  SelfHostedEnvironment,
  buildResult,
  continuousGrowthTrend,
  findForbiddenPayloadFields,
  isOrdinaryApiEndpoint,
  parseArgs,
  readDatabaseAudit,
  readDatabaseStats,
  summarizeResources,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
