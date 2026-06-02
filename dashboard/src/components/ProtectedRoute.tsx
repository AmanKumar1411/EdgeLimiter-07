import { Navigate } from "react-router-dom";
import { sessionStore } from "@/lib/api";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireRole?: "client" | "super_admin";
}

export function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const session = sessionStore.get();
  if (!session) return <Navigate to="/login" replace />;
  if (requireRole === "super_admin" && session.role !== "super_admin") {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
