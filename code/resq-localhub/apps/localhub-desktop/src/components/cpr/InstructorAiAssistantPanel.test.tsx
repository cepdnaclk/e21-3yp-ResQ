import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { InstructorAiAssistantPanel } from "./InstructorAiAssistantPanel";
import { queryInstructorCoach } from "../../api/sessionsApi";
import { useAuth } from "../../auth/AuthContext";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api/sessionsApi", () => ({
  queryInstructorCoach: vi.fn(),
}));

describe("InstructorAiAssistantPanel", () => {
  const mockTrainees = [
    { id: "t-1", displayName: "Alice Doe", traineeCode: "A01" }
  ];
  const mockSessions = [
    { sessionId: "s-123", traineeId: "t-1", startedAt: "2026-07-06T10:00:00Z", endedAt: "2026-07-06T10:01:00Z" }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders for INSTRUCTOR user role", () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-1", role: "INSTRUCTOR", username: "instructor1" }
    } as any);

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    expect(screen.getByText("Instructor AI Assistant")).toBeInTheDocument();
    expect(screen.getByText("Ask training-focused questions based on completed CPR sessions.")).toBeInTheDocument();
  });

  it("renders for ADMIN user role", () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-admin", role: "ADMIN", username: "admin1" }
    } as any);

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    expect(screen.getByText("Instructor AI Assistant")).toBeInTheDocument();
  });

  it("does not render for TRAINEE user role", () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-trainee", role: "TRAINEE", username: "trainee1" }
    } as any);

    const { container } = render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    expect(container.firstChild).toBeNull();
  });

  it("suggested question button fills the question input", () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-1", role: "INSTRUCTOR", username: "instructor1" }
    } as any);

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    const suggestedBtn = screen.getByText("Which trainees need attention today?");
    fireEvent.click(suggestedBtn);

    const input = screen.getByPlaceholderText(/Ask training-focused questions/);
    expect(input).toHaveValue("Which trainees need attention today?");
  });

  it("submitting calls queryInstructorCoach and displays the response sections correctly", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-1", role: "INSTRUCTOR", username: "instructor1" }
    } as any);

    const mockResponse = {
      answer: "Trainee Alice needs attention for depth rhythm.",
      priorityTrainees: [
        { traineeId: "t-1", name: "Alice Doe", lastSessionScore: 65, reasonForAttention: "Shallow compressions", lastSessionId: "s-123" }
      ],
      commonIssues: ["Shallow compressions"],
      suggestedInstructorActions: ["Practice pushing deeper"],
      relatedSessionIds: ["s-123"]
    };

    vi.mocked(queryInstructorCoach).mockResolvedValue(mockResponse as any);

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    const input = screen.getByPlaceholderText(/Ask training-focused questions/);
    fireEvent.change(input, { target: { value: "Which trainees need attention today?" } });

    const submitBtn = screen.getByRole("button", { name: "Ask Assistant" });
    fireEvent.click(submitBtn);

    // Verify loading state
    expect(screen.getByText(/Generating local training insights/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Trainee Alice needs attention for depth rhythm.")).toBeInTheDocument();
    });

    expect(queryInstructorCoach).toHaveBeenCalledWith({
      question: "Which trainees need attention today?",
      traineeId: undefined,
      sessionId: undefined,
      fromDate: undefined,
      toDate: undefined
    });

    // Check custom response sections
    expect(screen.getByText("Trainees Needing Attention")).toBeInTheDocument();
    expect(screen.getByText("Alice Doe")).toBeInTheDocument();
    expect(screen.getByText("Last Score: 65%")).toBeInTheDocument();
    
    expect(screen.getByText("Widespread Mistakes")).toBeInTheDocument();

    expect(screen.getByText("Suggested Instructor Actions")).toBeInTheDocument();
    expect(screen.getByText("Practice pushing deeper")).toBeInTheDocument();

    expect(screen.getByText("Related Sessions")).toBeInTheDocument();
    expect(screen.getByText("s-123".substring(0, 8))).toBeInTheDocument();
  });

  it("renders error state correctly when API fails", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-1", role: "INSTRUCTOR", username: "instructor1" }
    } as any);

    vi.mocked(queryInstructorCoach).mockRejectedValue(new Error("Network Error"));

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    const input = screen.getByPlaceholderText(/Ask training-focused questions/);
    fireEvent.change(input, { target: { value: "Which trainees need attention today?" } });

    const submitBtn = screen.getByRole("button", { name: "Ask Assistant" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Network Error")).toBeInTheDocument();
  });

  it("renders custom 403 authorization message", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentUser: { id: "u-1", role: "INSTRUCTOR", username: "instructor1" }
    } as any);

    vi.mocked(queryInstructorCoach).mockRejectedValue({ status: 403 });

    render(<InstructorAiAssistantPanel trainees={mockTrainees as any} completedSessions={mockSessions as any} />);

    const input = screen.getByPlaceholderText(/Ask training-focused questions/);
    fireEvent.change(input, { target: { value: "Which trainees need attention today?" } });

    const submitBtn = screen.getByRole("button", { name: "Ask Assistant" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("You are not authorized to access instructor AI assistant.")).toBeInTheDocument();
  });
});
