import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { CoursesPage } from "./CoursesPage";
import { UsersPage } from "./UsersPage";
import { routeFromPath } from "../router";

test("renders cloud users returned by the management API", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{
    userId: "user-1",
    displayName: "Nimal Instructor",
    email: "nimal@example.test",
    role: "INSTRUCTOR",
    active: true,
    createdAt: "2026-06-08T08:00:00Z",
    updatedAt: "2026-06-08T08:00:00Z",
  }])));

  render(<UsersPage />);

  expect(await screen.findByText("Nimal Instructor")).toBeInTheDocument();
  expect(screen.getByText("INSTRUCTOR")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();
});

test("renders courses and instructor choices", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/api/cloud/courses")) {
      return Promise.resolve(jsonResponse([{
        courseId: "course-1",
        courseCode: "CPR-101",
        title: "CPR Foundations",
        description: "Core compression practice",
        instructorId: "user-1",
        instructorDisplayName: "Nimal Instructor",
        active: true,
        createdAt: "2026-06-08T08:00:00Z",
        updatedAt: "2026-06-08T08:00:00Z",
      }]));
    }
    return Promise.resolve(jsonResponse([{
      userId: "user-1",
      displayName: "Nimal Instructor",
      email: "nimal@example.test",
      role: "INSTRUCTOR",
      active: true,
      createdAt: "2026-06-08T08:00:00Z",
      updatedAt: "2026-06-08T08:00:00Z",
    }]));
  }));

  render(<CoursesPage />);

  expect(await screen.findByText("CPR Foundations")).toBeInTheDocument();
  expect(screen.getAllByText("Nimal Instructor")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "View course" })).toBeInTheDocument();
});

test("routes course IDs to the management detail page", () => {
  expect(routeFromPath("/management/courses/course%201")).toEqual({
    name: "course-detail",
    courseId: "course 1",
  });
});

function jsonResponse(value: unknown): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  };
}
