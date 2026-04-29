import { Navigate } from "react-router-dom";
import { sessionStore } from "@/lib/api";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireRole?: "client" | "super_admin";
}

export function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const session = sessionStore.get();
  if (!session) {
    return (
      <Navigate
        to={requireRole === "super_admin" ? "/admin-login" : "/login"}
        replace
      />
    );
  }

  if (requireRole && session.role !== requireRole) {
    return (
      <Navigate
        to={session.role === "super_admin" ? "/admin" : "/dashboard"}
        replace
      />
    );
  }

  return <>{children}</>;
}
