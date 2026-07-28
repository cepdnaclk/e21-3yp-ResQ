import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";
import RoleBasedRoute from "./RoleBasedRoute";
import type { AuthUser } from "@resq/shared";

const authState: {
  currentUser: AuthUser | null;
  isLoading: boolean;
  bootstrap: { requiresFirstAdmin: boolean } | null;
} = {
  currentUser: null,
  isLoading: false,
  bootstrap: { requiresFirstAdmin: false },
};

vi.mock("./AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../pages/LoginPage", () => ({
  default: ({ firstRunRequired }: { firstRunRequired: boolean }) => <div>{firstRunRequired ? "First admin required" : "Login required"}</div>,
}));

vi.mock("../pages/AccessDeniedPage", () => ({
  default: () => <div>Access denied</div>,
}));

const instructor = { id: "u1", username: "inst", displayName: "Inst", role: "INSTRUCTOR" } as AuthUser;
const trainee = { id: "u2", username: "trainee", displayName: "Trainee", role: "TRAINEE" } as AuthUser;

beforeEach(() => {
  authState.currentUser = null;
  authState.isLoading = false;
  authState.bootstrap = { requiresFirstAdmin: false };
});

describe("route guards", () => {
  it("does not expose protected children while auth is loading", () => {
    authState.isLoading = true;
    render(<ProtectedRoute><div>Secret</div></ProtectedRoute>);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("renders login or first-admin setup for unauthenticated users", () => {
    const { rerender } = render(<ProtectedRoute><div>Secret</div></ProtectedRoute>);
    expect(screen.getByText("Login required")).toBeInTheDocument();

    authState.bootstrap = { requiresFirstAdmin: true };
    rerender(<ProtectedRoute><div>Secret</div></ProtectedRoute>);
    expect(screen.getByText("First admin required")).toBeInTheDocument();
  });

  it("allows authorized roles and blocks unauthorized roles", () => {
    authState.currentUser = instructor;
    const { rerender } = render(<ProtectedRoute allowedRoles={["INSTRUCTOR"]}><div>Instructor content</div></ProtectedRoute>);
    expect(screen.getByText("Instructor content")).toBeInTheDocument();

    authState.currentUser = trainee;
    rerender(<ProtectedRoute allowedRoles={["INSTRUCTOR"]}><div>Instructor content</div></ProtectedRoute>);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("delegates RoleBasedRoute permissions to ProtectedRoute", () => {
    authState.currentUser = instructor;
    render(<RoleBasedRoute allowedRoles={["ADMIN"]}><div>Admin content</div></RoleBasedRoute>);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });
});
