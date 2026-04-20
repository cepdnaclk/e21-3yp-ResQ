export interface HubHealthResponse {
  status: 'ok' | 'error';
  hubName: string;
  version: string;
}