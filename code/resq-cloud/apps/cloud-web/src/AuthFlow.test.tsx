import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";
import { AppShell } from "./components/AppShell";
import type { CloudUser } from "./api/cloudApi";

test("login page renders for an unauthenticated user", async () => {
  window.history.replaceState({}, "", "/login");

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Sign in to ResQ Cloud Review" })).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("protected routes redirect unauthenticated users to login", async () => {
  window.history.replaceState({}, "", "/sessions");

  render(<App />);

  await waitFor(() => expect(window.location.pathname).toBe("/login"));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("role-aware navigation hides admin management from instructors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      status: "UP",
      service: "resq-cloud-api",
      version: "local-dev",
      storageMode: "POSTGRESQL",
      timestamp: "2026-06-08T08:00:00Z",
    }),
  }));

  render(
    <AppShell currentPath="/sessions" user={user("INSTRUCTOR")} onLogout={() => undefined}>
      <div>Review content</div>
    </AppShell>,
  );

  expect(await screen.findByText("UP | POSTGRESQL")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Courses" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
});

test("trainee navigation exposes only the history placeholder", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      status: "UP",
      storageMode: "POSTGRESQL",
    }),
  }));

  render(
    <AppShell currentPath="/me" user={user("TRAINEE")} onLogout={() => undefined}>
      <div>Profile content</div>
    </AppShell>,
  );

  expect(await screen.findByText("UP | POSTGRESQL")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My History" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sessions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Courses" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
});

function user(role: CloudUser["role"]): CloudUser {
  return {
    userId: `${role.toLowerCase()}-1`,
    displayName: `${role} User`,
    email: `${role.toLowerCase()}@resq.test`,
    role,
    active: true,
    createdAt: "2026-06-08T08:00:00Z",
    updatedAt: "2026-06-08T08:00:00Z",
  };
}
