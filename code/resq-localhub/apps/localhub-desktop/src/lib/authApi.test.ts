import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUser,
  disableUser,
  enableUser,
  fetchAuthStatus,
  fetchCurrentUser,
  fetchUsers,
  login,
  logout,
  setupFirstAdmin,
} from "./authApi";
import { getStoredToken, setStoredToken } from "./tokenStore";
import { jsonResponse, lastFetchCall, mockFetch } from "../test/fetchMock";

const user = { id: "u1", username: "alex", displayName: "Alex", role: "INSTRUCTOR" };

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("tokenStore", () => {
  it("stores, reads, and clears the bearer token", () => {
    expect(getStoredToken()).toBeNull();
    setStoredToken("token-1");
    expect(getStoredToken()).toBe("token-1");
    setStoredToken(null);
    expect(getStoredToken()).toBeNull();
  });
});

describe("authApi", () => {
  it("logs in with JSON credentials and returns token and user", async () => {
    const fetchMock = mockFetch(jsonResponse({ token: "token-1", user }));

    await expect(login({ username: "alex", password: "secret" })).resolves.toEqual({ token: "token-1", user });

    const [url, init] = lastFetchCall(fetchMock);
    expect(String(url)).toBe("http://localhost:18080/api/auth/login");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ username: "alex", password: "secret" });
  });

  it("maps validation and auth failures to backend error messages", async () => {
    mockFetch(jsonResponse({ error: "Invalid credentials" }, { status: 401, statusText: "Unauthorized" }));

    await expect(login({ username: "bad", password: "wrong" })).rejects.toThrow("Invalid credentials");
  });

  it("falls back when error JSON is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403, statusText: "Forbidden" })));

    await expect(fetchAuthStatus()).rejects.toThrow("Request failed (403)");
  });

  it("returns null for unauthenticated current user and throws for other failures", async () => {
    mockFetch(jsonResponse({ error: "no session" }, { status: 401 }));
    await expect(fetchCurrentUser()).resolves.toBeNull();

    mockFetch(jsonResponse({ message: "backend down" }, { status: 500 }));
    await expect(fetchCurrentUser()).rejects.toThrow("Failed to load current user (500)");
  });

  it("adds Authorization for authenticated user operations", async () => {
    setStoredToken("token-1");
    const fetchMock = mockFetch(
      jsonResponse([user]),
      jsonResponse({ ...user, role: "ADMIN" }),
      jsonResponse({ ...user, disabled: true }),
      jsonResponse(user),
    );

    await fetchUsers();
    await createUser({ username: "new", displayName: "New User", password: "pw", role: "TRAINEE" });
    await disableUser("user/one");
    await enableUser("user/one");

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer token-1" });
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:18080/api/auth/users");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ username: "new", role: "TRAINEE" });
    expect(fetchMock.mock.calls[2][0]).toContain("/users/user%2Fone/disable");
    expect(fetchMock.mock.calls[3][0]).toContain("/users/user%2Fone/enable");
  });

  it("sets up first admin and sends logout with credentials", async () => {
    setStoredToken("token-1");
    const fetchMock = mockFetch(jsonResponse({ token: "admin-token", user: { ...user, role: "ADMIN" } }), jsonResponse({ ok: true }));

    await setupFirstAdmin({ username: "admin", displayName: "Admin", password: "secret" });
    await logout();

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:18080/api/auth/setup");
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:18080/api/auth/logout");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "include" });
  });
});
