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

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});