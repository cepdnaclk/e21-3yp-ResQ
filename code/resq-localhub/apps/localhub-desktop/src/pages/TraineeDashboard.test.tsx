import { render, screen } from "@testing-library/react";
import TraineeDashboard from "./TraineeDashboard";
import { fetchBrowserHealth } from "../lib/browserHealthApi";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    currentUser: null,
    logout: vi.fn(),
  }),
}));

vi.mock("../lib/browserHealthApi", () => ({
  fetchBrowserHealth: vi.fn(),
}));

vi.mock("../lib/browserSessionsApi", () => ({
  fetchSessionLive: vi.fn(),
  getSessionLiveStreamUrl: vi.fn(() => "http://localhost:18080/api/stream/sessions/live/test"),
}));

describe("TraineeDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchBrowserHealth).mockResolvedValue({
      ok: true,
      service: "hub-api",
      timestamp: new Date().toISOString(),
    });
  });

  it("shows the waiting session story when no session is assigned", async () => {
    render(<TraineeDashboard embeddedInDesktop />);

    expect(await screen.findByRole("heading", { name: "Ready for the next CPR scenario" })).toBeInTheDocument();
    expect(screen.getByText("Ready for the next CPR scenario")).toBeInTheDocument();
    expect(screen.getByText("Helpful tip")).toBeInTheDocument();
  });
});
