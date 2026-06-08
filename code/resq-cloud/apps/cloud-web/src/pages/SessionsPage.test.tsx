import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SessionsPage } from "./SessionsPage";

test("renders synced sessions returned by the isolated API client", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{
      cloudSessionId: "cloud-123456789",
      idempotencyKey: "HUB-1:S-1",
      createdAt: "2026-06-08T08:01:31Z",
      updatedAt: "2026-06-08T08:01:31Z",
      payload: {
        contractVersion: "resq.cloud.session-summary.v1",
        entityType: "SESSION_SUMMARY",
        localHubId: "HUB-1",
        localSessionId: "S-1",
        deviceId: "M01",
        status: "COMPLETED",
        score: 92,
      },
    }],
  }));

  render(<SessionsPage />);

  expect(await screen.findByText("S-1")).toBeInTheDocument();
  expect(screen.getByText("COMPLETED")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View details" })).toBeInTheDocument();
});

test("shows a useful error when cloud-api is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  render(<SessionsPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Cloud API is unavailable");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
