import { vi } from "vitest";

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function emptyResponse(init: ResponseInit = {}): Response {
  return new Response(null, { status: init.status ?? 204, statusText: init.statusText, headers: init.headers });
}

export function mockFetch(...responses: Array<Response | Promise<Response>>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  responses.forEach((response) => {
    fetchMock.mockResolvedValueOnce(response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export function lastFetchCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  if (!call) {
    throw new Error("fetch was not called");
  }
  return call as [RequestInfo | URL, RequestInit | undefined];
}
