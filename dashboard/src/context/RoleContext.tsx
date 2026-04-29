import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

export type Role = "super_admin" | "client_admin";

type RoleContextValue = {
  role: Role;
  setRole: (role: Role) => void;
};

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

const DEFAULT_ROLE: Role = "client_admin";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useLocalStorage<Role>(
    "edge-limiter-role",
    DEFAULT_ROLE,
  );

  const value = useMemo(() => ({ role, setRole }), [role, setRole]);

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) {
    throw new Error("useRole must be used within RoleProvider");
  }
  return ctx;
}

type RoleGateProps = {
  allow: Role[];
  children: ReactNode;
  fallback?: ReactNode;
};

export function RoleGate({ allow, children, fallback = null }: RoleGateProps) {
  const { role } = useRole();

  if (!allow.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
