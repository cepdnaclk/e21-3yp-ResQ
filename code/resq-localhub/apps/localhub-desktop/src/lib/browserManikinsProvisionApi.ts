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
  wifi_password: string;
  backend_base_url: string;
};

export type DeviceRegistrationResponse = {
  ok: boolean;
  device_id: string;
  mqtt_host: string;
  mqtt_port: number;
};

function backendBase(): string {
  return `http://${window.location.hostname}:18080`;
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
    wifi_password: wifiPassword,
    backend_base_url: serviceInfo.backend_base_url,
  };
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
