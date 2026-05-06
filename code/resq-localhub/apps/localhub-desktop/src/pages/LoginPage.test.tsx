import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    bootstrap: { firstRunRequired: false },
    currentUser: null,
    isLoading: false,
    login: vi.fn(),
    setupFirstAdmin: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    disableUser: vi.fn(),
  }),
}));

describe("LoginPage", () => {
  it("renders the sign in form", () => {
    render(<LoginPage />);

    expect(screen.getByText("ResQ Local Hub")).toBeInTheDocument();
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });
});
