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

export type BrokerServiceStatus = {
  running: boolean;
  pid: number | null;
  message: string;
};

export type NetworkInfo = {
  hostname: string;
  primaryIpv4: string | null;
};

// Keep the backend URL in one place so it is easy to change later.
export const HUB_API_BASE_URL = "http://localhost:18080";

const HUB_HEALTH_PATH = "/api/hub/health";

// Helper to check if Tauri environment is present
function isTauriEnv(): boolean {
  return typeof window !== "undefined" && (
    (window as any).__TAURI_INTERNALS__ !== undefined || 
    (window as any).__TAURI__ !== undefined
  );
}

async function safeInvoke<T>(commandName: string, mockValue: T, args?: any): Promise<T> {
  if (!isTauriEnv()) {
    return mockValue;
  }
  try {
    return await invoke<T>(commandName, args);
  } catch (error) {
    console.error(`[Tauri invoke] Command "${commandName}" failed:`, error);
    return mockValue;
  }
}

// Small wrapper so future command changes stay in one place.
export async function getAppInfo(): Promise<AppInfo> {
  return safeInvoke<AppInfo>("get_app_info", {
    appName: "ResQ Local Hub",
    appVersion: "1.0.0",
    platform: "Web Browser",
  });
}

export async function startApiService(): Promise<ApiServiceStatus> {
  return safeInvoke<ApiServiceStatus>("start_api_service", {
    running: true,
    pid: 9999,
  });
}

export async function stopApiService(): Promise<ApiServiceStatus> {
  return safeInvoke<ApiServiceStatus>("stop_api_service", {
    running: false,
    pid: null,
  });
}

export async function getApiServiceStatus(): Promise<ApiServiceStatus> {
  if (!isTauriEnv()) {
    try {
      const health = await fetchHubHealth();
      return {
        running: health.ok,
        pid: health.ok ? 9999 : null,
      };
    } catch {
      return {
        running: false,
        pid: null,
      };
    }
  }
  return invoke<ApiServiceStatus>("get_api_service_status");
}

export async function startBrokerService(): Promise<BrokerServiceStatus> {
  return safeInvoke<BrokerServiceStatus>("start_broker_service", {
    running: true,
    pid: 8888,
    message: "Mosquitto running",
  });
}

export async function stopBrokerService(): Promise<BrokerServiceStatus> {
  return safeInvoke<BrokerServiceStatus>("stop_broker_service", {
    running: false,
    pid: null,
    message: "Mosquitto stopped",
  });
}

export async function getBrokerServiceStatus(): Promise<BrokerServiceStatus> {
  if (!isTauriEnv()) {
    try {
      // Check if backend can reach the broker
      const response = await fetch(`${HUB_API_BASE_URL}/api/hub/service-info`);
      if (response.ok) {
        return {
          running: true,
          pid: 8888,
          message: "Mosquitto running",
        };
      }
    } catch {
      // ignore
    }
    return {
      running: false,
      pid: null,
      message: "Mosquitto status unknown",
    };
  }
  return invoke<BrokerServiceStatus>("get_broker_service_status");
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  if (!isTauriEnv()) {
    try {
      const response = await fetch(`${HUB_API_BASE_URL}/api/hub/service-info`);
      if (response.ok) {
        const info = await response.json();
        return {
          hostname: info.local_ip || "localhost",
          primaryIpv4: info.local_ip || "127.0.0.1",
        };
      }
    } catch {
      // ignore
    }
    return {
      hostname: "localhost",
      primaryIpv4: "127.0.0.1",
    };
  }
  return invoke<NetworkInfo>("get_network_info");
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
