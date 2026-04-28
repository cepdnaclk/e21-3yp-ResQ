export const USER_ROLES = ["ADMIN", "INSTRUCTOR", "TRAINEE"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROUTE_ROLE_RULES = {
  desktop: ["ADMIN", "INSTRUCTOR"],
  instructor: ["ADMIN", "INSTRUCTOR"],
  trainee: ["ADMIN", "INSTRUCTOR", "TRAINEE"],
  diagnostics: ["ADMIN"],
  users: ["ADMIN"],
  setup: ["ADMIN", "INSTRUCTOR"],
} as const satisfies Record<string, readonly UserRole[]>;
