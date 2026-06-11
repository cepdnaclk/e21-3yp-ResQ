import { vi } from "vitest";
import { CloudApiError, fetchCloudUsers } from "./cloudApi";
import { saveAuthSession } from "../auth/authStorage";

test("management API calls preserve useful HTTP error details", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    text: async () => "Email is already in use",
  }));

  await expect(fetchCloudUsers()).rejects.toEqual(
    expect.objectContaining<Partial<CloudApiError>>({
      name: "CloudApiError",
      status: 409,
      message: expect.stringContaining("Email is already in use"),
    }),
  );
});

test("protected API calls attach the stored bearer token", async () => {
  saveAuthSession({
    accessToken: "local-jwt",
    expiresAt: "2026-06-09T00:00:00Z",
    user: {
      userId: "admin-1",
      displayName: "ResQ Admin",
      email: "admin@resq.local",
      role: "ADMIN",
      active: true,
      createdAt: "2026-06-08T08:00:00Z",
      updatedAt: "2026-06-08T08:00:00Z",
    },
  });
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  });
  vi.stubGlobal("fetch", fetchMock);

  await fetchCloudUsers();

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/api/cloud/users"),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer local-jwt" }),
    }),
  );
});
