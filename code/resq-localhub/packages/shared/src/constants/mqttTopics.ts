export const MQTT_NAMESPACE = "resq";

export const mqttTopics = {
  status: (mac: string) => `resq/${mac}/status`,
  live: (mac: string) => `resq/${mac}/live`,
  events: (mac: string) => `resq/${mac}/events`,
  control: (mac: string) => `resq/${mac}/control`,
  sessionSummary: (mac: string, sessionId: string) =>
    `resq/${mac}/session/${sessionId}/summary`,
} as const;