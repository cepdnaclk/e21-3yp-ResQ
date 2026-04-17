export const LOCAL_DEFAULTS = {
  HUB_NAME: "resq-hub",
  DB_PATH: "./data/resq.db",
  LOG_LEVEL: "info",
  HEALTHCHECK_TIMEOUT_MS: 1500,
  PAIRING_TOKEN_TTL_SEC: 120,
} as const;