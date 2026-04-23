import { invoke } from "@tauri-apps/api/core";

export type AppInfo = {
  appName: string;
  appVersion: string;
  platform: string;
};

export type HubHealthResponse = {
  ok: boolean;
  service?: string;
  timestamp?: string;
};

export type ApiServiceStatus = {
  running: boolean;
  pid: number | null;
};

// Keep the backend URL in one place so it is easy to change later.
export const HUB_API_BASE_URL = "http://localhost:8080";

const HUB_HEALTH_PATH = "/api/hub/health";

// Small wrapper so future command changes stay in one place.
export async function getAppInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("get_app_info");
}

export async function startApiService(): Promise<ApiServiceStatus> {
  return invoke<ApiServiceStatus>("start_api_service");
}

export async function stopApiService(): Promise<ApiServiceStatus> {
  return invoke<ApiServiceStatus>("stop_api_service");
}

export async function getApiServiceStatus(): Promise<ApiServiceStatus> {
  return invoke<ApiServiceStatus>("get_api_service_status");
}

function isHubHealthResponse(value: unknown): value is HubHealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;

  return (
    typeof response.ok === "boolean" &&
    (response.service === undefined || typeof response.service === "string") &&
    (response.timestamp === undefined || typeof response.timestamp === "string")
  );
}

function getHubHealthUrl(baseUrl: string = HUB_API_BASE_URL): string {
  return new URL(HUB_HEALTH_PATH, baseUrl).toString();
}

export async function fetchHubHealth(baseUrl: string = HUB_API_BASE_URL): Promise<HubHealthResponse> {
  const response = await fetch(getHubHealthUrl(baseUrl));

  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`);
  }

  const data: unknown = await response.json();

  if (!isHubHealthResponse(data)) {
    throw new Error("Invalid response");
  }

  return data;
}
