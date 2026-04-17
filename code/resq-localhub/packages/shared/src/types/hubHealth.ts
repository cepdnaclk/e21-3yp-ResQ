export interface HubHealthResponse {
  ok: true;
  hubName: string;
  apiPort: number;
  mqttTcpPort: number;
  mqttWsPort?: number;
  webBaseUrl: string;
  mode: "local";
  ts: number;
}