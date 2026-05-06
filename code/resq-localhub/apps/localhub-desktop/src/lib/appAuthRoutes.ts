import type { UserRole } from "@resq/shared";

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  ADMIN: "/instructor",
  INSTRUCTOR: "/instructor",
  TRAINEE: "/trainee",
};
