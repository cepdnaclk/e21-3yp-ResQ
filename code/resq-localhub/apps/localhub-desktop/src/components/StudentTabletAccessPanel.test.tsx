import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudentTabletAccessPanel, { buildSessionDashboardUrl } from "./StudentTabletAccessPanel";
import {
  getStudentDashboardStatus,
  refreshStudentDashboardAddress,
} from "../lib/tauriApi";

vi.mock("../lib/hubApiUrl", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("../lib/tauriApi", () => ({
  getStudentDashboardStatus: vi.fn(),
  refreshStudentDashboardAddress: vi.fn(),
}));

const readyStatus = {
  running: true,
  port: 1420,
  lanIp: "192.168.8.100",
  url: "http://192.168.8.100:1420",
  backendUrl: "http://192.168.8.100:18080",
  error: null,
};

describe("StudentTabletAccessPanel", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.mocked(getStudentDashboardStatus).mockResolvedValue(readyStatus);
    vi.mocked(refreshStudentDashboardAddress).mockResolvedValue({
      ...readyStatus,
      lanIp: "192.168.137.1",
      url: "http://192.168.137.1:1420",
      backendUrl: "http://192.168.137.1:18080",
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("renders the running dashboard QR and copies the detected URL", async () => {
    render(<StudentTabletAccessPanel backendAvailable />);

    expect(await screen.findByText("http://192.168.8.100:1420")).toBeInTheDocument();
    expect(screen.getByTitle("General student dashboard QR code")).toBeInTheDocument();
    expect(screen.getByText("Backend available")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://192.168.8.100:1420"));
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });

  it("refreshes the LAN address through the Tauri command", async () => {
    render(<StudentTabletAccessPanel backendAvailable />);
    await screen.findByText("http://192.168.8.100:1420");

    fireEvent.click(screen.getByRole("button", { name: "Refresh Network" }));

    await waitFor(() => expect(refreshStudentDashboardAddress).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("http://192.168.137.1:1420")).toBeInTheDocument();
  });

  it("shows unavailable LAN and occupied-port errors", async () => {
    vi.mocked(getStudentDashboardStatus).mockResolvedValueOnce({
      running: false,
      port: 1420,
      lanIp: null,
      url: null,
      backendUrl: null,
      error: "Student dashboard could not start because port 1420 is unavailable.",
    });

    render(<StudentTabletAccessPanel backendAvailable={false} />);

    expect(await screen.findByText(/port 1420 is unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText("No LAN address detected")).toHaveLength(2);
    expect(screen.getByText("Backend unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Link" })).toBeDisabled();
  });

  it("shows an encoded session QR only for an authorized assigned session", async () => {
    render(
      <StudentTabletAccessPanel
        backendAvailable
        activeSessionId="session/id with spaces"
        canShareActiveSession
      />,
    );

    const expected = "http://192.168.8.100:1420/trainee/sessions/session%2Fid%20with%20spaces/live";
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByTitle("Active trainee session QR code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy Session Link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
  });

  it("does not expose a session URL without sharing authorization", async () => {
    render(
      <StudentTabletAccessPanel
        backendAvailable
        activeSessionId="session-1"
        canShareActiveSession={false}
      />,
    );

    await screen.findByText("http://192.168.8.100:1420");
    expect(screen.queryByTitle("Active trainee session QR code")).not.toBeInTheDocument();
  });
});

describe("buildSessionDashboardUrl", () => {
  it("URL-encodes the complete session identifier", () => {
    expect(buildSessionDashboardUrl("http://10.0.0.5:1420/", "S/01 ready")).toBe(
      "http://10.0.0.5:1420/trainee/sessions/S%2F01%20ready/live",
    );
  });
});
