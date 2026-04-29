import { useState } from "react";
import { Navigate } from "react-router-dom";
import { sessionStore, type Session } from "@/lib/api";
import { DashboardShell, CLIENT_NAV } from "@/components/DashboardShell";
import { LiveControlSection } from "../sections/LiveControlSection";
import { PoliciesSection } from "../sections/PoliciesSection";
import { AnalyticsSection } from "../sections/AnalyticsSection";
import { OperationsSection } from "../sections/OperationsSection";
import { AuditSection } from "../sections/AuditSection";
import {SecurityIntelSection} from "../sections/SecurityIntelSection";

export default function ClientDashboard() {
  const initial = sessionStore.get();
  const [session, setSession] = useState<Session | null>(initial);
  const [active, setActive] = useState("live");

  if (!session) return <Navigate to="/login" replace />;

  function updateTenant(tenantId: string) {
    if (!session || tenantId === session.tenantId) return;
    const next = { ...session, tenantId };
    sessionStore.set(next);
    setSession(next);
  }

  return (
    <DashboardShell
      session={session}
      nav={CLIENT_NAV}
      active={active}
      onActiveChange={setActive}
      portalLabel="Client Portal"
    >
      {active === "live" && (
        <LiveControlSection session={session} onTenantChange={updateTenant} />
      )}
      {active === "policies" && (
        <PoliciesSection session={session} onTenantChange={updateTenant} />
      )}
      {active === "analytics" && <AnalyticsSection />}
      {active === "operations" && (
        <OperationsSection session={session} onTenantChange={updateTenant} />
      )}
      {active === "security" && <SecurityIntelSection session={session} />}
      {active === "audit" && <AuditSection />}
    </DashboardShell>
  );
}
