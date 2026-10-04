import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = resolve(desktopDir, "../../services/hub-api");
export const packagedJarPath = join(desktopDir, "src-tauri/resources/hub-api/resq-hub-api.jar");

function builtJarPath() {
  const target = join(backendDir, "target");
  const jars = readdirSync(target).filter(name => /^hub-api-.*\.jar$/.test(name));
  if (jars.length !== 1) throw new Error(`Expected exactly one backend JAR in ${target}, found ${jars.length}. Rebuild the backend.`);
  return join(target, jars[0]);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function verifyStagedBackend() {
  try {
    const source = builtJarPath();
    const hash = sha256(source);
    if (sha256(packagedJarPath) !== hash) throw new Error("Staged JAR differs from the Maven output");
    console.log(`Verified backend: ${packagedJarPath}\nSHA256: ${hash}`);
  } catch (error) {
    throw new Error(`${error.message}. Run smoke-runtime.mjs without --staged to clean-build and stage the current backend.`);
  }
}

export function buildAndStageBackend() {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "cmd.exe" : "./mvnw",
    windows ? ["/d", "/s", "/c", "mvnw.cmd", "clean", "package"] : ["clean", "package"],
    { cwd: backendDir, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Backend clean package failed (${result.status}); refusing to stage an old JAR.`);
  mkdirSync(dirname(packagedJarPath), { recursive: true });
  copyFileSync(builtJarPath(), packagedJarPath);
  verifyStagedBackend();
}
