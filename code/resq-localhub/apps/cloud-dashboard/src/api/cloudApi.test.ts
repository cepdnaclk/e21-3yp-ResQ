import { vi } from "vitest";
import { CloudApiError, fetchCloudUsers } from "./cloudApi";

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
