import type { ReactNode } from "react";
import type { UserRole } from "@resq/shared";
import ProtectedRoute from "./ProtectedRoute";

type RoleBasedRouteProps = {
  allowedRoles: readonly UserRole[];
  children: ReactNode;
};

export default function RoleBasedRoute({ allowedRoles, children }: RoleBasedRouteProps) {
  return <ProtectedRoute allowedRoles={allowedRoles}>{children}</ProtectedRoute>;
}
