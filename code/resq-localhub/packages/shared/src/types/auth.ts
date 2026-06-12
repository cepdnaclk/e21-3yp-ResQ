import type { UserRole } from "../constants/roles";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  disabledAt?: string | null;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  user: AuthUser;
  token: string;
  expiresAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type AuthBootstrapResponse = {
  firstRunRequired: boolean;
};

export type AuthStatusResponse = {
  hasUsers: boolean;
  requiresFirstAdmin: boolean;
};

export type CreateFirstAdminRequest = {
  username: string;
  displayName: string;
  password: string;
};

export type CreateUserRequest = {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
};

export type AuthPermissionRule = readonly UserRole[];

export const AUTH_PERMISSION_RULES = {
  desktop: ["ADMIN", "INSTRUCTOR"],
  instructor: ["ADMIN", "INSTRUCTOR"],
  trainee: ["ADMIN", "INSTRUCTOR", "TRAINEE"],
  diagnostics: ["ADMIN"],
  users: ["ADMIN"],
  setup: ["ADMIN", "INSTRUCTOR"],
} as const satisfies Record<string, AuthPermissionRule>;
