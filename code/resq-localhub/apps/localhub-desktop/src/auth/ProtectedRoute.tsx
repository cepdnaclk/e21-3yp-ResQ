import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import AccessDeniedPage from "../pages/AccessDeniedPage";
import LoginPage from "../pages/LoginPage";
import type { UserRole } from "@resq/shared";

type ProtectedRouteProps = {
  allowedRoles?: readonly UserRole[];
  children: ReactNode;
};

export default function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { currentUser, isLoading, bootstrap } = useAuth();

  if (isLoading) {
    return <div style={{ padding: "24px" }}>Loading...</div>;
  }

  if (!currentUser) {
    return <LoginPage firstRunRequired={bootstrap?.requiresFirstAdmin ?? false} />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(currentUser.role)) {
    return <AccessDeniedPage />;
  }

  return <>{children}</>;
}
