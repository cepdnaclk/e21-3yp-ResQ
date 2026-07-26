import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import InstructorAiAssistantPage from "./InstructorAiAssistantPage";
import { queryInstructorCoach, fetchCompletedSessions } from "../../api/sessionsApi";
import { fetchTrainees } from "../../api/traineesApi";

vi.mock("../../api/sessionsApi", () => ({
  queryInstructorCoach: vi.fn(),
  fetchCompletedSessions: vi.fn(),
}));

vi.mock("../../api/traineesApi", () => ({
  fetchTrainees: vi.fn(),
}));

describe("InstructorAiAssistantPage", () => {
  const mockTrainees = [
    { id: "t-1", displayName: "Alice Doe", traineeCode: "A01" }
  ];
  const mockSessions = [
    { sessionId: "s-123", traineeId: "t-1", startedAt: "2026-07-06T10:00:00Z", endedAt: "2026-07-06T10:01:00Z" }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchTrainees).mockResolvedValue(mockTrainees as any);
    vi.mocked(fetchCompletedSessions).mockResolvedValue(mockSessions as any);
  });

  it("renders page header and main UI elements", async () => {
    const handleBack = vi.fn();
    render(<InstructorAiAssistantPage onBack={handleBack} />);

    // Verify metadata loading state
    expect(screen.getByText("Loading instructor assistant workspace...")).toBeInTheDocument();

    // Wait for metadata load
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Instructor AI Assistant" })).toBeInTheDocument();
    });

    expect(screen.getByText("Analyze completed CPR sessions and get training-focused instructor support.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type your training-focused question here...")).toBeInTheDocument();
  });

  it("fills the question input when suggested question pill is clicked", async () => {
    render(<InstructorAiAssistantPage onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "Instructor AI Assistant" });

    const suggestedBtn = screen.getByText("Which trainees need attention today?");
    fireEvent.click(suggestedBtn);

    const textarea = screen.getByPlaceholderText("Type your training-focused question here...");
    expect(textarea).toHaveValue("Which trainees need attention today?");
  });

  it("calls queryInstructorCoach on submit and renders all response sections", async () => {
    const mockResponse = {
      answer: "Alice is doing great.",
      priorityTrainees: [
        { traineeId: "t-1", name: "Alice Doe", lastSessionScore: 92, reasonForAttention: "Slight rate inconsistency", lastSessionId: "s-123" }
      ],
      commonIssues: ["Rate inconsistency"],
      suggestedInstructorActions: ["Monitor rate stability"],
      relatedSessionIds: ["s-123"]
    };

    vi.mocked(queryInstructorCoach).mockResolvedValue(mockResponse as any);

    render(<InstructorAiAssistantPage onBack={vi.fn()} />);

    await screen.findByRole("heading", { name: "Instructor AI Assistant" });

    const textarea = screen.getByPlaceholderText("Type your training-focused question here...");
    fireEvent.change(textarea, { target: { value: "Tell me about Alice" } });

    const submitBtn = screen.getByRole("button", { name: "Ask Assistant" });
    fireEvent.click(submitBtn);

    // Verify query submit state
    expect(screen.getByText(/Generating local training insights/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Alice is doing great.")).toBeInTheDocument();
    });

    // Check headings and values
    expect(screen.getByText("Answer")).toBeInTheDocument();
    
    expect(screen.getByText("Priority Trainees")).toBeInTheDocument();
    expect(screen.getByText("Alice Doe")).toBeInTheDocument();
    expect(screen.getByText("Last Score: 92%")).toBeInTheDocument();

    expect(screen.getByText("Common Issues")).toBeInTheDocument();
    expect(screen.getByText("Rate inconsistency")).toBeInTheDocument();

    expect(screen.getByText("Suggested Instructor Actions")).toBeInTheDocument();
    expect(screen.getByText("Monitor rate stability")).toBeInTheDocument();

    expect(screen.getByText("Related Session IDs")).toBeInTheDocument();
    expect(screen.getByText("s-123")).toBeInTheDocument();
  });
});
