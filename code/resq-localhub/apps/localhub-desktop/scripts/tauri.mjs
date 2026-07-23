import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const targetDir = path.join(os.tmpdir(), "resq-localhub-tauri-target");
const tauriBinary = process.platform === "win32"
  ? path.join(process.cwd(), "node_modules", ".bin", "tauri.cmd")
  : path.join(process.cwd(), "node_modules", ".bin", "tauri");

const child = spawn(tauriBinary, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    CARGO_TARGET_DIR: targetDir,
  },
});

let exiting = false;

function stopChildTree(signal) {
  if (exiting) {
    return;
  }
  exiting = true;

  if (!child.pid) {
    process.exit(0);
    return;
  }

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("exit", () => {
      const force = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      force.on("exit", () => process.exit(0));
    });
    return;
  }

  child.kill(signal);
  process.exit(0);
}

process.on("SIGINT", () => stopChildTree("SIGINT"));
process.on("SIGTERM", () => stopChildTree("SIGTERM"));

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (exiting) {
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
