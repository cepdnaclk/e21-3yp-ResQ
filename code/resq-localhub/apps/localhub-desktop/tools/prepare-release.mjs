import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(toolsDir, "..");
const backendDir = resolve(desktopDir, "../../services/hub-api");
const backendTargetDir = join(backendDir, "target");
const resourcesDir = join(desktopDir, "src-tauri", "resources");
const packagedJarPath = join(resourcesDir, "hub-api", "resq-hub-api.jar");
const packagedRuntimeDir = join(resourcesDir, "jre");

const runtimeModules = [
  "java.base",
  "java.desktop",
  "java.instrument",
  "java.logging",
  "java.management",
  "java.naming",
  "java.net.http",
  "java.prefs",
  "java.security.jgss",
  "java.security.sasl",
  "java.sql",
  "java.transaction.xa",
  "java.xml",
  "jdk.crypto.ec",
  "jdk.unsupported",
  "jdk.zipfs",
];

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

function findJlink() {
  const executableName = process.platform === "win32" ? "jlink.exe" : "jlink";
  const javaHome = process.env.JAVA_HOME?.trim();
  if (javaHome) {
    const candidate = join(javaHome, "bin", executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [executableName],
    { encoding: "utf8" },
  );
  const candidate = lookup.stdout?.split(/\r?\n/u).find(Boolean)?.trim();
  if (lookup.status === 0 && candidate && existsSync(candidate)) {
    return candidate;
  }

  throw new Error("jlink was not found. Install a Java 17 JDK and set JAVA_HOME.");
}

function buildBackendJar() {
  if (process.platform === "win32") {
    run(
      "cmd.exe",
      ["/d", "/s", "/c", "mvnw.cmd", "clean", "package", "-DskipTests"],
      backendDir,
    );
  } else {
    run("./mvnw", ["clean", "package", "-DskipTests"], backendDir);
  }

  const jarName = readdirSync(backendTargetDir).find(
    (name) => name.startsWith("hub-api-") && name.endsWith(".jar") && !name.endsWith(".jar.original"),
  );
  if (!jarName) {
    throw new Error(`No packaged hub-api JAR was produced in ${backendTargetDir}`);
  }

  mkdirSync(dirname(packagedJarPath), { recursive: true });
  copyFileSync(join(backendTargetDir, jarName), packagedJarPath);
  console.log(`Packaged backend: ${packagedJarPath}`);
}

function buildJavaRuntime() {
  const jlink = findJlink();
  rmSync(packagedRuntimeDir, { recursive: true, force: true });

  run(
    jlink,
    [
      "--add-modules",
      runtimeModules.join(","),
      "--output",
      packagedRuntimeDir,
      "--strip-debug",
      "--no-header-files",
      "--no-man-pages",
      "--compress=2",
    ],
    desktopDir,
  );

  console.log(`Packaged Java runtime: ${packagedRuntimeDir}`);
}

try {
  buildBackendJar();
  buildJavaRuntime();
} catch (error) {
  console.error(`Release preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
