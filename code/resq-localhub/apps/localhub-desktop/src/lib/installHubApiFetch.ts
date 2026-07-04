import { getHubApiBaseUrl } from "./hubApiUrl";
import { getStoredToken } from "./tokenStore";

let installed = false;

function isHubApiRequest(input: RequestInfo | URL): boolean {
  const rawUrl = input instanceof Request ? input.url : input.toString();

  try {
    return new URL(rawUrl, window.location.href).origin === new URL(getHubApiBaseUrl()).origin;
  } catch {
    return false;
  }
}

export function installHubApiFetch(): void {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getStoredToken();
    if (!token || !isHubApiRequest(input)) {
      return originalFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (!headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return originalFetch(input, {
      ...init,
      headers,
    });
  };
}
