import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import type { AuthUser } from "../types/auth";

const adminUser: AuthUser = {
  id: "u-1",
  username: "resq-dev",
  displayName: "ResQ Dev",
  role: "ADMIN",
  enabled: true,
};

describe("AppShell", () => {
  it("shows simplified navigation, current user details, and sign out", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    const setPage = vi.fn();

    render(
      <AppShell
        currentUser={adminUser}
        connectionHealthy={true}
        lastApiSuccessAt={Date.now()}
        onLogout={onLogout}
        page="home"
        setPage={setPage}
      >
        <div>Shell content</div>
      </AppShell>
    );

    expect(screen.getAllByText("ResQ Dev").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Administrator").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("LocalHub Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Active Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded non-scrolling content region for live dashboards", () => {
    render(
      <AppShell
        currentUser={adminUser}
        connectionHealthy
        lastApiSuccessAt={Date.now()}
        onLogout={vi.fn()}
        page="instructor"
        setPage={vi.fn()}
        contentMode="dashboard"
      >
        <div>Live dashboard</div>
      </AppShell>,
    );

    expect(screen.getByRole("main")).toHaveAttribute("data-content-mode", "dashboard");
    expect(screen.getByRole("main")).toHaveClass("overflow-hidden");
  });
});
