export const MANUAL_LAN_IP_STORAGE_KEY = "resq.localhub.manualLanIpOverride";

export type HostSelectionSource = "manual" | "auto" | "none";

export type HostSelection = {
  chosenHost: string | null;
  source: HostSelectionSource;
};

export function sanitizeManualLanIp(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveChosenHost(manualOverride: string | null, detectedIp: string | null): HostSelection {
  if (manualOverride) {
    return { chosenHost: manualOverride, source: "manual" };
  }

  if (detectedIp) {
    return { chosenHost: detectedIp, source: "auto" };
  }

  return { chosenHost: null, source: "none" };
}
