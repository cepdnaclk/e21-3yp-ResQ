import { buildAndStageBackend } from "./backend-release.mjs";
import {
  cpSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(toolsDir, "..");
const resourcesDir = join(desktopDir, "src-tauri", "resources");
const packagedRuntimeDir = join(resourcesDir, "jre");
const frontendDistDir = join(desktopDir, "dist");
const packagedWebDashboardDir = join(resourcesDir, "web-dashboard");
const releaseScriptPath = resolve(desktopDir, "../../scripts/release/prepare-release.ps1");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function buildJavaRuntime() {
  const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const args =
    process.platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", releaseScriptPath]
      : ["-NoProfile", "-File", releaseScriptPath];
  run(command, args, desktopDir);
  console.log(`Packaged Java runtime: ${packagedRuntimeDir}`);
}

function buildWebDashboard() {
  if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/s", "/c", "npm.cmd", "run", "build"], desktopDir);
  } else {
    run("npm", ["run", "build"], desktopDir);
  }

  if (!existsSync(join(frontendDistDir, "index.html"))) {
    throw new Error(`Vite did not produce ${join(frontendDistDir, "index.html")}`);
  }

  rmSync(packagedWebDashboardDir, { recursive: true, force: true });
  cpSync(frontendDistDir, packagedWebDashboardDir, { recursive: true });
  writeFileSync(join(packagedWebDashboardDir, ".gitkeep"), "");
  console.log(`Packaged student dashboard: ${packagedWebDashboardDir}`);
}

try {
  for (const name of ["mosquitto.exe", "mosquitto.conf", "mosquitto_common.dll", "libcrypto-3-x64.dll", "libssl-3-x64.dll", "cjson.dll", "pthreadVC3.dll", "libmicrohttpd-dll.dll"]) {
    if (!existsSync(join(resourcesDir, "mosquitto", name))) {
      throw new Error(`Missing release broker resource: ${name}`);
    }
  }
  buildAndStageBackend();
  buildJavaRuntime();
  buildWebDashboard();
  run(process.execPath, [resolve(desktopDir, "../../scripts/release/smoke-runtime.mjs"), "--staged"], desktopDir);
} catch (error) {
  console.error(`Release preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
