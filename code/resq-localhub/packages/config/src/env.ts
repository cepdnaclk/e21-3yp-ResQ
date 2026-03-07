type EnvConfig = {
  MQTT_PORT: number;
  MQTT_WS_PORT: number;
  API_PORT: number;
  HUB_NAME: string;
  DB_PATH: string;
  LOG_LEVEL: string;
};

export function parseEnv(): EnvConfig {
  return {
    MQTT_PORT: Number(process.env.MQTT_PORT) || 1883,
    MQTT_WS_PORT: Number(process.env.MQTT_WS_PORT) || 9001,
    API_PORT: Number(process.env.API_PORT) || 8080,
    HUB_NAME: process.env.HUB_NAME || 'resq-hub',
    DB_PATH: process.env.DB_PATH || './data/resq.db',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  };
}// environment variable definitions and helpers
// TODO: load from process.env with defaults
