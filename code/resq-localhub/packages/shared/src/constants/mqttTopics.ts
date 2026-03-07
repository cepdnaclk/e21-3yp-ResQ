export const MQTT_TOPICS = {
  status: (mac: string) => `resq/${mac}/status`,
  live: (mac: string) => `resq/${mac}/live`,
  events: (mac: string) => `resq/${mac}/events`,
  control: (mac: string) => `resq/${mac}/control`,
  sessionSummary: (mac: string, sessionId: string) => `resq/${mac}/session/${sessionId}/summary`,
};// MQTT topic constants
// TODO: list topic strings used across the app
