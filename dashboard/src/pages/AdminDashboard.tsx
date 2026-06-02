import { useState } from "react";
import { Navigate } from "react-router-dom";
import { sessionStore, type Session } from "@/lib/api";
import { DashboardShell, ADMIN_NAV } from "@/components/DashboardShell";
import { SystemOverviewSection } from "@/components/sections/SystemOverviewSection";
import { TenantsSection } from "@/components/sections/TenantsSection";
import { SecurityIntelSection } from "@/components/sections/SecurityIntelSection";
import { TopKeysSection } from "@/components/sections/TopKeysSection";
import { RegisterUserSection } from "@/components/sections/RegisterUserSection";
import { AuditSection } from "@/components/sections/AuditSection";

export default function AdminDashboard() {
  const initial = sessionStore.get();
  const [session, setSession] = useState<Session | null>(initial);
  const [active, setActive] = useState("overview");

  if (!session || session.role !== "super_admin") {
    return <Navigate to="/admin-login" replace />;
  }

  function updateTenant(tenantId: string) {
    if (!session || tenantId === session.tenantId) return;
    const next = { ...session, tenantId };
    sessionStore.set(next);
    setSession(next);
  }

  return (
    <DashboardShell
      session={session}
      nav={ADMIN_NAV}
      active={active}
      onActiveChange={setActive}
      portalLabel="Admin Portal"
    >
      {active === "overview" && <SystemOverviewSection />}
      {active === "tenants" && (
        <TenantsSection session={session} onTenantChange={updateTenant} />
      )}
      {active === "global-security" && <SecurityIntelSection session={session} />}
      {active === "top-keys" && <TopKeysSection />}
      {active === "register" && <RegisterUserSection />}
      {active === "audit" && <AuditSection />}
    </DashboardShell>
  );
}
