import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthBootstrapResponse, AuthUser, CreateFirstAdminRequest, CreateUserRequest, LoginRequest, LoginResponse } from "@resq/shared";
import {
  createUser as createUserRequest,
  disableUser as disableUserRequest,
  fetchAuthBootstrap,
  fetchCurrentUser,
  fetchUsers,
  login as loginRequest,
  logout as logoutRequest,
  setupFirstAdmin as setupFirstAdminRequest,
} from "../lib/authApi";

type AuthContextValue = {
  bootstrap: AuthBootstrapResponse | null;
  currentUser: AuthUser | null;
  isLoading: boolean;
  login: (request: LoginRequest) => Promise<LoginResponse>;
  setupFirstAdmin: (request: CreateFirstAdminRequest) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  listUsers: () => Promise<AuthUser[]>;
  createUser: (request: CreateUserRequest) => Promise<AuthUser>;
  disableUser: (userId: string) => Promise<AuthUser>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<AuthBootstrapResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthState() {
      try {
        const [bootstrapResponse, userResponse] = await Promise.all([
          fetchAuthBootstrap(),
          fetchCurrentUser(),
        ]);

        if (cancelled) {
          return;
        }

        setBootstrap(bootstrapResponse);
        setCurrentUser(userResponse);
      } catch {
        if (!cancelled) {
          setBootstrap({ firstRunRequired: false });
          setCurrentUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadAuthState();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSession() {
    const userResponse = await fetchCurrentUser();
    setCurrentUser(userResponse);
  }

  async function login(request: LoginRequest) {
    const response = await loginRequest(request);
    setCurrentUser(response.user);
    return response;
  }

  async function setupFirstAdmin(request: CreateFirstAdminRequest) {
    const response = await setupFirstAdminRequest(request);
    setCurrentUser(response.user);
    return response;
  }

  async function logout() {
    await logoutRequest();
    setCurrentUser(null);
  }

  async function listUsers() {
    return fetchUsers();
  }

  async function createUser(request: CreateUserRequest) {
    return createUserRequest(request);
  }

  async function disableUser(userId: string) {
    return disableUserRequest(userId);
  }

  const value = useMemo<AuthContextValue>(() => ({
    bootstrap,
    currentUser,
    isLoading,
    login,
    setupFirstAdmin,
    logout,
    refreshSession,
    listUsers,
    createUser,
    disableUser,
  }), [bootstrap, currentUser, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
