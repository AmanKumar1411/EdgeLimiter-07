import { createContext, useContext } from "react";
import type { Session } from "./api";

export interface TenantScope {
  tenantId: string;
  session: Session;
  /** Where this tenant's pages live: "/dashboard" or "/admin/t/<tenantId>". */
  basePath: string;
  /**
   * False when an admin is viewing another tenant: /check only accepts the
   * tenant's own keys, and new keys would belong to the admin, not the tenant.
   */
  isOwnTenant: boolean;
}

export const TenantContext = createContext<TenantScope | null>(null);

export function useTenant() {
  const scope = useContext(TenantContext);
  if (!scope) throw new Error("useTenant() must be used inside a tenant route");
  return scope;
}
