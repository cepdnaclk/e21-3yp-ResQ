// Tests staged resources, NOT an installed Tauri/WebView application.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import assert from "node:assert/strict";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/localhub-desktop");
const resources = join(desktop, "src-tauri/resources");
const require = createRequire(join(desktop, "package.json"));
const mqtt = require("mqtt");
const target = join(desktop, "src-tauri/target");
mkdirSync(target, { recursive: true });
const runDir = mkdtempSync(join(target, "runtime-smoke-"));
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
const apiPort = await freePort(), tcpPort = await freePort(), wsPort = await freePort();
const children = [], clients = [];
function launch(executable, args, name) {
  const log = openSync(join(runDir, `${name}.log`), "a");
  const child = spawn(executable, args, { cwd: runDir, windowsHide: true, stdio: ["ignore", log, log] });
  child.on("error", error => { console.error(`${name}: ${error.message}`); });
  children.push(child);
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(r => { child.once("exit", r); child.kill(); });
}
const base = `http://127.0.0.1:${apiPort}`;
function startApi() {
  return launch(join(resources, "jre/bin/java.exe"), [
    `-Duser.home=${runDir}`, "-jar", join(resources, "hub-api/resq-hub-api.jar"),
    `--spring.config.additional-location=${join(resources, "config/application-release.properties")}`,
    `--server.port=${apiPort}`, `--resq.mqtt.broker-url=tcp://127.0.0.1:${tcpPort}`,
    "--resq.cloud-sync.enabled=false", "--resq.roster-sync.enabled=false",
  ], "hub-api");
}
async function ready(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited: ${child.exitCode}; see ${runDir}`);
    try { if ((await fetch(base + "/api/hub/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(300);
  }
  throw new Error(`Backend readiness timeout; see ${runDir}`);
}
try {
  const conf = join(runDir, "mosquitto.conf");
  writeFileSync(conf, `persistence false\nlistener ${tcpPort} 127.0.0.1\nprotocol mqtt\nallow_anonymous true\nlistener ${wsPort} 127.0.0.1\nprotocol websockets\nallow_anonymous true\n`);
  const broker = launch(join(resources, "mosquitto/mosquitto.exe"), ["-c", conf], "mosquitto");
  for (const port of [tcpPort, wsPort]) {
    const deadline = Date.now() + 10_000;
    while (true) {
      const available = await new Promise(res => {
        const socket = net.connect(port, "127.0.0.1");
        socket.on("connect", () => { socket.destroy(); res(true); });
        socket.on("error", () => res(false));
      });
      if (available) break;
      if (broker.exitCode !== null || Date.now() > deadline) throw new Error(`Broker not ready; see ${runDir}`);
      await delay(100);
    }
  }
  for (const url of [`mqtt://127.0.0.1:${tcpPort}`, `ws://127.0.0.1:${wsPort}`]) {
    const client = mqtt.connect(url, { connectTimeout: 5000, reconnectPeriod: 0 });
    clients.push(client);
    await new Promise((res, rej) => { client.once("connect", res); client.once("error", rej); });
    await client.subscribeAsync("resq/release-smoke");
    const received = new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error("MQTT delivery timeout")), 5000);
      client.once("message", (_, payload) => { clearTimeout(timer); assert.equal(payload.toString(), "probe"); res(); });
    });
    await client.publishAsync("resq/release-smoke", "probe"); await received;
  }
  console.log("PASS staged Mosquitto TCP and WebSocket publish/subscribe");
  let api = startApi(); await ready(api);
  const setup = await fetch(base + "/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "release-smoke", displayName: "Release smoke", password: "Smoke-only-Password-739!" }) });
  assert.equal(setup.status, 200);
  const { token } = await setup.json(); assert.ok(token);
  const headers = { Authorization: `Bearer ${token}`, Origin: "http://tauri.localhost" };
  const me = await fetch(base + "/api/auth/me", { headers }); assert.equal(me.status, 200);
  const syncStatus = await fetch(base + "/api/sync/cloud/status", { headers });
  assert.equal(syncStatus.status, 200);
  const sync = await syncStatus.json();
  assert.equal(sync.enabled, false); assert.equal(sync.pendingCount, 0);
  assert.equal(me.headers.get("access-control-allow-origin"), "http://tauri.localhost");
  const denied = await fetch(base + "/api/stream/manikins/live"); assert.ok([401, 403].includes(denied.status));
  for (const route of ["manikins/live", "sessions/live/smoke-session"]) {
    const abort = new AbortController();
    const response = await fetch(base + "/api/stream/" + route, { headers, signal: abort.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const timer = setTimeout(() => abort.abort(), 20_000);
    let data = "";
    try {
      while (!data.includes("event:heartbeat")) {
        const chunk = await reader.read(); assert.equal(chunk.done, false);
        data += new TextDecoder().decode(chunk.value);
      }
    } finally { clearTimeout(timer); abort.abort(); await reader.cancel().catch(() => {}); }
  }
  console.log("PASS staged REST, bearer authentication, Tauri-origin CORS, both SSE streams and heartbeats, cloud disabled");
  await stop(api); api = startApi(); await ready(api);
  assert.equal((await fetch(base + "/api/auth/me", { headers })).status, 200);
  console.log("PASS staged backend restart and persisted authentication/database");
} finally {
  for (const client of clients) client.end(true);
  for (const child of children.reverse()) await stop(child);
  console.log(`Runtime smoke logs: ${runDir}`);
}
