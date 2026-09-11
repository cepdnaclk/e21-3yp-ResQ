import { getHubApiBaseUrl } from "./hubApiUrl";

// Browser-safe helpers for local firmware onboarding/provisioning.

export type HubServiceInfoResponse = {
  ok: boolean;
  backend_base_url: string;
  mqtt_host: string;
  mqtt_port: number;
  dashboard_url?: string | null;
  local_ip?: string | null;
};

export type FirmwareProvisioningPayload = {
  wifi_ssid: string;
  wifi_pass: string;
  backend_base_url: string;
};

export type EspProvisioningUrlInput = {
  espSetupBaseUrl?: string;
  espProvisionPath?: string;
  wifiSsid: string;
  wifiPassword: string;
  backendBaseUrl: string;
  autoSave?: boolean;
};

export type DeviceRegistrationResponse = {
  ok: boolean;
  device_id: string;
  mqtt_host: string;
  mqtt_port: number;
};

function backendBase(): string {
  return getHubApiBaseUrl();
}

export async function fetchHubServiceInfo(): Promise<HubServiceInfoResponse> {
  const response = await fetch(`${backendBase()}/api/hub/service-info`);
  if (!response.ok) {
    throw new Error(`Service info request failed (${response.status})`);
  }
  return response.json() as Promise<HubServiceInfoResponse>;
}

export function buildFirmwareProvisioningPayload(
  serviceInfo: HubServiceInfoResponse,
  wifiSsid: string,
  wifiPassword: string,
): FirmwareProvisioningPayload {
  return {
    wifi_ssid: wifiSsid,
    wifi_pass: wifiPassword,
    backend_base_url: serviceInfo.backend_base_url,
  };
}

function normalizeEspBaseUrl(rawBaseUrl: string | undefined): string {
  const trimmed = (rawBaseUrl ?? "http://192.168.4.1").trim();
  const fallback = "http://192.168.4.1";
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/g, "") || fallback;
}

function normalizeEspPath(rawPath: string | undefined): string {
  const trimmed = (rawPath ?? "/").trim();
  if (!trimmed) {
    return "/";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (collapsed === "/") {
    return "/";
  }

  return collapsed.replace(/\/+$/g, "") || "/";
}

export function buildEspProvisioningUrl({
  espSetupBaseUrl = "http://192.168.4.1",
  espProvisionPath = "/",
  wifiSsid,
  wifiPassword,
  backendBaseUrl,
  autoSave = true,
}: EspProvisioningUrlInput): string {
  const base = normalizeEspBaseUrl(espSetupBaseUrl);
  const path = normalizeEspPath(espProvisionPath);
  const url = new URL(`${base}${path}`);

  url.searchParams.set("wifi_ssid", wifiSsid.trim());
  url.searchParams.set("wifi_pass", wifiPassword);
  url.searchParams.set("backend_base_url", backendBaseUrl.trim());

  if (autoSave) {
    url.searchParams.set("auto", "1");
  }

  return url.toString();
}

export async function registerFirmwareDevice(payload: {
  mac?: string;
  chip_id?: string;
  firmware_version?: string;
  device_label?: string;
} = {}): Promise<DeviceRegistrationResponse> {
  const response = await fetch(`${backendBase()}/api/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Device registration failed (${response.status})`);
  }
  return response.json() as Promise<DeviceRegistrationResponse>;
}
