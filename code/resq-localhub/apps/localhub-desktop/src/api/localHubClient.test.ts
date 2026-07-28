import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson, postJson, patchJson, deleteJson, buildApiUrl, buildDownloadUrl } from "./localHubClient";
import { jsonResponse, emptyResponse, lastFetchCall, mockFetch } from "../test/fetchMock";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localHubClient", () => {
  it("builds hub API and download URLs from the current host", () => {
    expect(buildApiUrl("api/sessions")).toBe("http://localhost:18080/api/sessions");
    expect(buildDownloadUrl("/api/export/sessions/s1.csv")).toBe("http://localhost:18080/api/export/sessions/s1.csv");
  });

  it("sends GET requests with encoded query parameters", async () => {
    const fetchMock = mockFetch(jsonResponse([{ id: "s1" }]));

    await expect(getJson("/api/sessions", { limit: 10, includeDrafts: false, skip: undefined })).resolves.toEqual([{ id: "s1" }]);

    const [url, init] = lastFetchCall(fetchMock);
    expect(String(url)).toBe("http://localhost:18080/api/sessions?limit=10&includeDrafts=false");
    expect(init).toMatchObject({ method: "GET", credentials: "include" });
  });

  it("sends JSON mutation methods and handles 204 responses", async () => {
    const fetchMock = mockFetch(jsonResponse({ id: "one" }), jsonResponse({ id: "two" }), emptyResponse());

    await postJson("/api/items", { name: "One" });
    await patchJson("/api/items/one", { name: "Two" });
    await expect(deleteJson("/api/items/one")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
  });

  it("normalizes HTTP errors from JSON bodies and fallback statuses", async () => {
    mockFetch(jsonResponse({ error: "Duplicate session" }, { status: 409 }));
    await expect(getJson("/api/sessions")).rejects.toMatchObject({ message: "Duplicate session", status: 409 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 503 })));
    await expect(getJson("/api/sessions")).rejects.toThrow("temporarily unavailable");
  });
});
