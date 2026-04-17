export type LogLevel = "debug" | "info" | "warn" | "error";
export type EnvMap = Record<string, string | undefined>;

export interface AppConfig {
  hubName: string;
  apiPort: number;
  mqttTcpPort: number;
  mqttWsPort: number;
  webPort: number;
  dbPath: string;
  logLevel: LogLevel;
  mqttHost: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      return "info";
  }
}

export function loadConfig(env: EnvMap): AppConfig {
  return {
    hubName: env.HUB_NAME || "resq-hub",
    apiPort: parseNumber(env.API_PORT, 8080),
    mqttTcpPort: parseNumber(env.MQTT_PORT, 1883),
    mqttWsPort: parseNumber(env.MQTT_WS_PORT, 9001),
    webPort: parseNumber(env.WEB_PORT, 5173),
    dbPath: env.DB_PATH || "./data/resq.db",
    logLevel: parseLogLevel(env.LOG_LEVEL),
    mqttHost: env.MQTT_HOST || "127.0.0.1",
  };
}

export function parseEnv(env: EnvMap): AppConfig {
  return loadConfig(env);
}