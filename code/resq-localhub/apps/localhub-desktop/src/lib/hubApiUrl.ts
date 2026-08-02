const DEFAULT_HUB_API_PORT = 18080;
const TAURI_HOSTNAMES = new Set(["tauri.localhost", "localhost.tauri"]);

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

type BrowserLocation = Pick<Location, "hostname" | "protocol">;

function resolveServiceHost(location?: BrowserLocation): string {
  if (!location) {
    return "127.0.0.1";
  }

  const { hostname, protocol } = location;
  if (!hostname || protocol === "tauri:" || protocol === "file:" || TAURI_HOSTNAMES.has(hostname)) {
    return "127.0.0.1";
  }

  return hostname;
}

export function resolveLocalHubApiBase(
  location?: BrowserLocation,
  configuredUrl?: string,
): string {
  if (configuredUrl?.trim()) {
    return normalizeBaseUrl(configuredUrl);
  }

  return `http://${resolveServiceHost(location)}:${DEFAULT_HUB_API_PORT}`;
}

export function getLocalServiceHost(): string {
  return resolveServiceHost(typeof window === "undefined" ? undefined : window.location);
}

export function getHubApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_HUB_API_BASE_URL;
  return resolveLocalHubApiBase(
    typeof window === "undefined" ? undefined : window.location,
    typeof configuredUrl === "string" ? configuredUrl : undefined,
  );
}

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    "__TAURI_INTERNALS__" in window ||
    window.location.protocol === "tauri:" ||
    TAURI_HOSTNAMES.has(window.location.hostname)
  );
}

export async function waitForHubApiReady(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `${getHubApiBaseUrl()}/api/hub/health`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // The packaged Spring service is still starting.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }

  throw new Error("The Local Hub backend did not become ready in time.");
}
