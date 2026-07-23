import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";

const { loginMock, fetchHubHealthMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  fetchHubHealthMock: vi.fn(),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    bootstrap: { hasUsers: true, requiresFirstAdmin: false },
    currentUser: null,
    isLoading: false,
    login: loginMock,
  }),
}));

vi.mock("../../lib/tauriApi", () => ({
  fetchHubHealth: fetchHubHealthMock,
}));

describe("V2 LoginPage", () => {
  beforeEach(() => {
    loginMock.mockReset();
    fetchHubHealthMock.mockReset();
    fetchHubHealthMock.mockResolvedValue({ ok: true });
  });

  it("renders refined login copy and connected LocalHub status", async () => {
    render(<LoginPage />);

    expect(screen.getByText("Manage CPR Training Locally")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to continue to ResQ LocalHub.")).toBeInTheDocument();

    expect(await screen.findByText("Connected to LocalHub")).toBeInTheDocument();
  });

  it("submits with Enter and maps invalid credentials to the friendly inline error", async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValueOnce(new Error("Invalid credentials"));

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Username"), "instructor");
    await user.type(screen.getByLabelText("Password"), "wrong{Enter}");

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith({ username: "instructor", password: "wrong" });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password. Please try again.");
  });

  it("toggles password visibility with accessible labels", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("shows a Caps Lock warning while the password field is focused", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const password = screen.getByLabelText("Password");
    await user.click(password);
    const capsLockEvent = createEvent.keyDown(password, { key: "A" });
    capsLockEvent.getModifierState = (key: string) => key === "CapsLock";
    fireEvent(password, capsLockEvent);

    expect(screen.getByText("Caps Lock is on.")).toBeInTheDocument();
  });

  it("disables repeated submissions while sign-in is pending", async () => {
    const user = userEvent.setup();
    loginMock.mockReturnValue(new Promise(() => undefined));

    render(<LoginPage />);

    await user.type(screen.getByLabelText("Username"), "instructor");
    await user.type(screen.getByLabelText("Password"), "correct-password");
    await user.dblClick(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", { name: /Signing in/i })).toBeDisabled();
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("shows unavailable connection state and retries health checks", async () => {
    const user = userEvent.setup();
    fetchHubHealthMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true });

    render(<LoginPage />);

    expect(await screen.findByText("LocalHub service unavailable. Start the LocalHub services and try again.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry connection" }));

    expect(await screen.findByText("Connected to LocalHub")).toBeInTheDocument();
    expect(fetchHubHealthMock).toHaveBeenCalledTimes(2);
  });
});
