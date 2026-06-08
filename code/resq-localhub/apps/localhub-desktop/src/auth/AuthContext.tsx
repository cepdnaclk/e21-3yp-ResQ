import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthStatusResponse, AuthUser, CreateFirstAdminRequest, CreateUserRequest, LoginRequest, LoginResponse, UserRole } from "@resq/shared";
import {
  createUser as createUserRequest,
  disableUser as disableUserRequest,
  fetchAuthBootstrap,
  fetchAuthStatus,
  fetchCurrentUser,
  fetchUsers,
  login as loginRequest,
  logout as logoutRequest,
  setupFirstAdmin as setupFirstAdminRequest,
} from "../lib/authApi";
import { getStoredToken, setStoredToken } from "../lib/tokenStore";

type AuthContextValue = {
  bootstrap: AuthStatusResponse | null;
  currentUser: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (request: LoginRequest) => Promise<LoginResponse>;
  setupFirstAdmin: (request: CreateFirstAdminRequest) => Promise<LoginResponse>;
  createFirstAdmin: (request: CreateFirstAdminRequest) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  listUsers: () => Promise<AuthUser[]>;
  createUser: (request: CreateUserRequest) => Promise<AuthUser>;
  disableUser: (userId: string) => Promise<AuthUser>;
  enableUser: (userId: string) => Promise<AuthUser>;
  hasRole: (roles: readonly UserRole[] | UserRole) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [bootstrap, setBootstrap] = useState<AuthStatusResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthState() {
      try {
        const [statusResponse, userResponse] = await Promise.all([
          fetchAuthStatus(),
          fetchCurrentUser(),
        ]);

        if (cancelled) {
          return;
        }

        setBootstrap(statusResponse);
        setCurrentUser(userResponse);
      } catch {
        if (!cancelled) {
          setBootstrap({ hasUsers: false, requiresFirstAdmin: false });
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
    // backend sets HttpOnly cookie; optional token support if stored elsewhere
    // mark that a session likely exists; backend uses HttpOnly cookie
    try {
      setStoredToken("session");
      setToken("session");
    } catch {}
    setCurrentUser(response.user);
    return response;
  }

  async function setupFirstAdmin(request: CreateFirstAdminRequest) {
    const response = await setupFirstAdminRequest(request);
    try {
      setStoredToken("session");
      setToken("session");
    } catch {}
    setCurrentUser(response.user);
    return response;
  }

  async function createFirstAdmin(request: CreateFirstAdminRequest) {
    // alias for setupFirstAdminRequest - backend uses /setup
    const response = await setupFirstAdminRequest(request);
    try {
      setStoredToken("session");
      setToken("session");
    } catch {}
    setCurrentUser(response.user);
    return response;
  }

  async function logout() {
    try {
      await logoutRequest();
    } catch (err) {
      // ignore network/backend logout errors - still clear client state
      // console.debug("logout request failed", err);
    }

    setCurrentUser(null);
    setToken(null);
    setStoredToken(null);
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

  async function enableUser(userId: string) {
    // import is named enableUser in lib/authApi
    // to avoid name clash with local function, call directly
    return (await import("../lib/authApi")).enableUser(userId);
  }

  const value = useMemo<AuthContextValue>(() => ({
    bootstrap,
    currentUser,
    token,
    isLoading,
    login,
    setupFirstAdmin,
    createFirstAdmin,
    logout,
    refreshSession,
    listUsers,
    createUser,
    disableUser,
    enableUser,
    hasRole: (roles: readonly UserRole[] | UserRole) => {
      if (!currentUser) return false;
      if (!roles) return false;
      if (Array.isArray(roles)) return roles.includes(currentUser.role);
      return currentUser.role === roles;
    },
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

export function useOptionalAuth() {
  return useContext(AuthContext);
}
