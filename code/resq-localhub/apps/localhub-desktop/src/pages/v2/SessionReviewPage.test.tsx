import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import SessionReviewPage from "./SessionReviewPage";
import { fetchCompletedSession, queryCoach } from "../../api/sessionsApi";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    currentUser: { id: "trainee-1", role: "TRAINEE" },
  }),
}));

vi.mock("../../api/sessionsApi", () => ({
  fetchCompletedSession: vi.fn(),
  queryCoach: vi.fn(),
}));

vi.mock("../../api/exportsApi", () => ({
  downloadSessionJson: vi.fn(),
  downloadSessionCsv: vi.fn(),
}));

describe("SessionReviewPage Ask ResQ Coach UI", () => {
  const mockSession = {
    sessionId: "session-123",
    traineeId: "trainee-1",
    startedAt: "2026-07-06T10:00:00Z",
    endedAt: "2026-07-06T10:01:00Z",
    scenario: "Standard CPR",
    summary: {
      score: 75,
      avgDepthMm: 52,
      avgRateCpm: 110,
      recoilPct: 95,
      pausesCount: 0,
      durationSeconds: 60,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCompletedSession).mockResolvedValue(mockSession as any);
  });

  it("renders suggested question buttons and form elements", async () => {
    render(<SessionReviewPage sessionId="session-123" onBack={vi.fn()} />);

    expect(await screen.findByText("Ask ResQ Coach")).toBeInTheDocument();

    expect(screen.getByText("List my bad performances in the last 3 weeks")).toBeInTheDocument();
    expect(screen.getByText("What mistakes do I repeat most?")).toBeInTheDocument();
    expect(screen.getByText("Am I improving?")).toBeInTheDocument();
    expect(screen.getByText("Compare my last session with my best session")).toBeInTheDocument();
    expect(screen.getByText("What should I practice next?")).toBeInTheDocument();

    expect(screen.getByPlaceholderText(/Type your question/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask Coach" })).toBeInTheDocument();
  });

  it("submits question when typing and clicking submit, showing loading and results", async () => {
    const mockCoachResponse = {
      answer: "Based on your training session data: you are doing well, but keep consistent.",
      mainIssues: ["Slight depth drop"],
      recommendations: ["Ensure complete release"],
      badSessions: [
        {
          sessionId: "bad-1",
          sessionDateTime: "2026-07-05T08:00:00Z",
          overallScore: 65,
          shortReason: "Shallow compressions",
          recommendation: "Focus on pushing deeper",
        },
      ],
      trendDirection: "STABLE",
    };

    vi.mocked(queryCoach).mockResolvedValue(mockCoachResponse as any);

    render(<SessionReviewPage sessionId="session-123" onBack={vi.fn()} />);
    expect(await screen.findByText("Ask ResQ Coach")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Type your question/);
    fireEvent.change(input, { target: { value: "Am I improving?" } });
    expect(input).toHaveValue("Am I improving?");

    const submitBtn = screen.getByRole("button", { name: "Ask Coach" });
    fireEvent.click(submitBtn);

    expect(screen.getByText(/Generating local clinical insights/)).toBeInTheDocument();

    expect(queryCoach).toHaveBeenCalledWith({
      userId: "trainee-1",
      question: "Am I improving?",
    });

    expect(await screen.findByText("you are doing well, but keep consistent", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("STABLE")).toBeInTheDocument();
    expect(screen.getByText("Slight depth drop")).toBeInTheDocument();
    expect(screen.getByText("Ensure complete release")).toBeInTheDocument();
    expect(screen.getByText("Shallow compressions")).toBeInTheDocument();
    expect(screen.getByText("Score: 65%")).toBeInTheDocument();
  });

  it("shows error boundary message when the API fails", async () => {
    vi.mocked(queryCoach).mockRejectedValue(new Error("API network failure"));

    render(<SessionReviewPage sessionId="session-123" onBack={vi.fn()} />);
    expect(await screen.findByText("Ask ResQ Coach")).toBeInTheDocument();

    const suggestedBtn = screen.getByText("What mistakes do I repeat most?");
    fireEvent.click(suggestedBtn);

    expect(await screen.findByText("API network failure")).toBeInTheDocument();
  });
});
