import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AuthUser } from "@resq/shared";
import type { ReactNode } from "react";

type MockAuth = {
  currentUser: AuthUser | null;
  isLoading: boolean;
  bootstrap: { hasUsers: boolean; requiresFirstAdmin: boolean } | null;
  logout: ReturnType<typeof vi.fn>;
};

const mockAuth: MockAuth = {
  currentUser: null,
  isLoading: false,
  bootstrap: { hasUsers: true, requiresFirstAdmin: false },
  logout: vi.fn().mockResolvedValue(undefined),
};

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

function Page({ name, children }: { name: string; children?: ReactNode }) {
  return <main><h1>{name}</h1>{children}</main>;
}

vi.mock("./layouts/AppShell", () => ({
  default: ({ children, currentUser, onLogout, setPage, page }: any) => (
    <div>
      <div>Shell page: {page}</div>
      <div>User: {currentUser.displayName}</div>
      <button onClick={() => setPage("home")}>Home nav</button>
      <button onClick={() => setPage("instructor")}>Instructor nav</button>
      <button onClick={() => setPage("sessions")}>Sessions nav</button>
      <button onClick={() => setPage("users")}>Users nav</button>
      <button onClick={() => setPage("diagnostics")}>Diagnostics nav</button>
      <button onClick={onLogout}>Sign out</button>
      {children}
    </div>
  ),
}));

vi.mock("./pages/v2/LoginPage", () => ({ default: () => <Page name="Login" /> }));
vi.mock("./pages/v2/SetupFirstAdminPage", () => ({ default: () => <Page name="Setup First Admin" /> }));
vi.mock("./pages/v2/LocalHubHomePage", () => ({ default: ({ onOpenInstructorDashboard }: any) => <Page name="Home"><button onClick={onOpenInstructorDashboard}>Open Instructor</button></Page> }));
vi.mock("./pages/v2/InstructorDashboardPage", () => ({ default: ({ onStartSession, onRunCalibration, onPairNewManikin, onViewRecentSessions }: any) => <Page name="Instructor"><button onClick={() => onStartSession("s1")}>Start live</button><button onClick={() => onRunCalibration("M-01")}>Calibrate</button><button onClick={onPairNewManikin}>Pair</button><button onClick={onViewRecentSessions}>Recent</button></Page> }));
vi.mock("./pages/v2/PairManikinPage", () => ({ default: ({ onBack }: any) => <Page name="Pair Manikin"><button onClick={onBack}>Back</button></Page> }));
vi.mock("./pages/v2/ManikinReadinessPage", () => ({ default: ({ deviceId }: any) => <Page name={`Readiness ${deviceId}`} /> }));
vi.mock("./pages/v2/CalibrationWizardPage", () => ({ default: ({ deviceId, onBack }: any) => <Page name={`Calibration ${deviceId}`}><button onClick={onBack}>Back</button></Page> }));
vi.mock("./pages/v2/InstructorLiveSessionPage", () => ({ default: ({ sessionId, onSessionEnded }: any) => <Page name={`Instructor Live ${sessionId}`}><button onClick={() => onSessionEnded(sessionId)}>End</button></Page> }));
vi.mock("./pages/v2/TraineeLiveSessionPage", () => ({ default: ({ sessionId, onSessionEnded }: any) => <Page name={`Trainee Live ${sessionId}`}><button onClick={onSessionEnded}>Done</button></Page> }));
vi.mock("./pages/v2/RecentSessionsPage", () => ({ default: ({ onSelectSession }: any) => <Page name="Recent Sessions"><button onClick={() => onSelectSession("s/1")}>Review</button></Page> }));
vi.mock("./pages/v2/SessionReviewPage", () => ({ default: ({ sessionId, onBack }: any) => <Page name={`Review ${sessionId}`}><button onClick={onBack}>Back</button></Page> }));
vi.mock("./pages/v2/AdminUsersPage", () => ({ default: () => <Page name="Admin Users" /> }));
vi.mock("./pages/v2/TechnicianDiagnosticsPage", () => ({ default: () => <Page name="Diagnostics" /> }));
vi.mock("./pages/v2/AccessDeniedPage", () => ({ default: ({ onBackToHome }: any) => <Page name="Access Denied"><button onClick={onBackToHome}>Back home</button></Page> }));
vi.mock("./pages/v2/CoursesPage", () => ({ default: () => <Page name="Courses" /> }));
vi.mock("./pages/v2/CourseDetailPage", () => ({ default: ({ courseId }: any) => <Page name={`Course ${courseId}`} /> }));
vi.mock("./pages/v2/StartSessionWizardPage", () => ({ default: () => <Page name="Start Session" /> }));
vi.mock("./pages/v2/ActiveSessionsPage", () => ({ default: ({ onViewLive, onNavigateHome }: any) => <Page name="Active Sessions"><button onClick={() => onViewLive("s2")}>Open live</button><button onClick={onNavigateHome}>Home</button></Page> }));
vi.mock("./pages/v2/AdminSyncDashboardPage", () => ({ default: () => <Page name="Admin Sync" /> }));
vi.mock("./pages/v2/DemoChecklistPage", () => ({ default: () => <Page name="Demo Checklist" /> }));
vi.mock("./pages/InstructorDashboard", () => ({ default: () => <Page name="Legacy Instructor" /> }));
vi.mock("./pages/TraineeDashboard", () => ({ default: ({ legacy }: any) => <Page name={legacy ? "Legacy Trainee" : "Trainee Dashboard"} /> }));

const admin = { id: "admin", username: "admin", displayName: "Admin", role: "ADMIN" } as AuthUser;
const instructor = { id: "inst", username: "inst", displayName: "Instructor", role: "INSTRUCTOR" } as AuthUser;
const trainee = { id: "trainee", username: "trainee", displayName: "Trainee", role: "TRAINEE" } as AuthUser;

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

function navigate(path: string) {
  act(() => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

beforeEach(() => {
  mockAuth.currentUser = admin;
  mockAuth.isLoading = false;
  mockAuth.bootstrap = { hasUsers: true, requiresFirstAdmin: false };
  mockAuth.logout = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  localStorage.clear();
  setPath("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App routing and authorization", () => {
  it("shows loading, first-admin setup, and login states before authentication", () => {
    mockAuth.isLoading = true;
    const { rerender } = render(<App />);
    expect(screen.getByText("Loading authentication...")).toBeInTheDocument();

    mockAuth.isLoading = false;
    mockAuth.currentUser = null;
    mockAuth.bootstrap = { hasUsers: false, requiresFirstAdmin: true };
    rerender(<App />);
    expect(screen.getByRole("heading", { name: "Setup First Admin" })).toBeInTheDocument();

    mockAuth.bootstrap = { hasUsers: true, requiresFirstAdmin: false };
    rerender(<App />);
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("routes authenticated admin through active pages and nested IDs", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open Instructor"));
    expect(await screen.findByRole("heading", { name: "Instructor" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Calibrate"));
    expect(await screen.findByRole("heading", { name: "Calibration M-01" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByText("Pair"));
    expect(await screen.findByRole("heading", { name: "Pair Manikin" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Instructor nav"));
    await screen.findByRole("heading", { name: "Instructor" });
    fireEvent.click(screen.getByText("Start live"));
    expect(await screen.findByRole("heading", { name: "Instructor Live s1" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("End"));
    expect(await screen.findByRole("heading", { name: "Review s1" })).toBeInTheDocument();
  });

  it("parses direct routes and browser popstate changes", async () => {
    setPath("/courses/c%2F1");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Course c/1" })).toBeInTheDocument();

    navigate("/sessions/s%2F1");
    expect(await screen.findByRole("heading", { name: "Review s/1" })).toBeInTheDocument();
  });

  it("blocks unauthorized roles and lets access denied navigate home", async () => {
    mockAuth.currentUser = trainee;
    setPath("/admin/users");
    render(<App />);

    expect(screen.getByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Back home"));
    expect(await screen.findByRole("heading", { name: "Trainee Dashboard" })).toBeInTheDocument();
  });

  it("routes trainees to trainee surfaces and blocks instructor-only live pages", async () => {
    mockAuth.currentUser = trainee;
    setPath("/trainee/sessions/s1/live");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Trainee Live s1" })).toBeInTheDocument();

    navigate("/instructor/sessions/s1/live");
    expect(await screen.findByRole("heading", { name: "Access Denied" })).toBeInTheDocument();
  });

  it("enforces admin-only and instructor/admin routes", async () => {
    mockAuth.currentUser = instructor;
    setPath("/diagnostics");
    render(<App />);
    expect(screen.getByRole("heading", { name: "Access Denied" })).toBeInTheDocument();

    navigate("/start-session");
    expect(await screen.findByRole("heading", { name: "Start Session" })).toBeInTheDocument();

    navigate("/demo-checklist");
    expect(await screen.findByRole("heading", { name: "Demo Checklist" })).toBeInTheDocument();
  });

  it("handles shell navigation and logout", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("Users nav"));
    expect(await screen.findByRole("heading", { name: "Admin Users" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Diagnostics nav"));
    expect(await screen.findByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sign out"));
    await waitFor(() => expect(mockAuth.logout).toHaveBeenCalled());
    expect(window.location.pathname).toBe("/login");
  });
});
