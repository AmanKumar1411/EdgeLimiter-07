import {
  Activity,
  Building2,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  Send,
  UserPlus,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, matchPath, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell, type NavGroup, type NavItem } from "./components/app-shell";
import { Select } from "./components/ui/input";
import { api, loginPath, sessionStore, type Role, type Session } from "./lib/api";
import { TenantContext, type TenantScope } from "./lib/tenant";
import { useApi } from "./lib/use-api";
import { Landing, Login, NotFound, Register } from "./pages/public";
import { SystemOverview, Tenants, Users } from "./pages/admin";
import { Activity as ActivityPage } from "./pages/activity";
import { Audit } from "./pages/audit";
import { Keys } from "./pages/keys";
import { Limits } from "./pages/limits";
import { Overview } from "./pages/overview";
import { Playground } from "./pages/playground";
import { Setup } from "./pages/setup";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login admin={false} />} />
      <Route path="/admin-login" element={<Login admin />} />

      <Route path="/dashboard" element={<RequireSession>{(s) => <ClientLayout session={s} />}</RequireSession>}>
        {tenantRoutes(true)}
      </Route>

      <Route
        path="/admin"
        element={<RequireSession role="super_admin">{(s) => <AdminLayout session={s} />}</RequireSession>}
      >
        <Route index element={<SystemOverview />} />
        <Route path="tenants" element={<Tenants />} />
        <Route path="users" element={<Users />} />
        <Route path="t/:tenantId" element={<AdminTenantScope />}>
          {tenantRoutes(false)}
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function tenantRoutes(withOnboarding: boolean) {
  return (
    <>
      <Route index element={<Overview />} />
      {withOnboarding && <Route path="setup" element={<Setup />} />}
      <Route path="limits" element={<Limits />} />
      <Route path="playground" element={<Playground />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="keys" element={<Keys />} />
      <Route path="audit" element={<Audit />} />
    </>
  );
}

function RequireSession({ role, children }: { role?: Role; children: (session: Session) => ReactNode }) {
  const session = sessionStore.get();
  if (!session) return <Navigate to={loginPath(role)} replace />;
  if (role && session.role !== role) return <Navigate to="/dashboard" replace />;
  return children(session);
}

function tenantNav(basePath: string, isOwnTenant: boolean, withOnboarding: boolean): NavItem[] {
  return [
    { to: basePath, label: "Overview", icon: LayoutDashboard, end: true },
    ...(withOnboarding ? [{ to: `${basePath}/setup`, label: "Get started", icon: ListChecks }] : []),
    { to: `${basePath}/limits`, label: "Limits", icon: Gauge },
    ...(isOwnTenant ? [{ to: `${basePath}/playground`, label: "Test request", icon: Send }] : []),
    { to: `${basePath}/activity`, label: "Activity", icon: Activity },
    { to: `${basePath}/keys`, label: "API keys", icon: KeyRound },
    { to: `${basePath}/audit`, label: "Audit log", icon: ScrollText },
  ];
}

/** Label of the nav item matching the current URL (most specific wins). */
function useCurrentLabel(nav: NavGroup[]) {
  const { pathname } = useLocation();
  return nav
    .flatMap((group) => group.items)
    .filter((item) => matchPath({ path: item.to, end: item.end ?? false }, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0]?.label;
}

function ClientLayout({ session }: { session: Session }) {
  const scope: TenantScope = { tenantId: session.tenantId, session, basePath: "/dashboard", isOwnTenant: true };
  const nav = [{ items: tenantNav("/dashboard", true, true) }];
  const page = useCurrentLabel(nav);

  return (
    <TenantContext.Provider value={scope}>
      <AppShell
        session={session}
        nav={nav}
        crumbs={[{ label: session.tenantId, to: "/dashboard" }, { label: page ?? "" }]}
        switcher={
          <div className="rounded border px-2.5 py-1.5">
            <div className="text-xs text-muted-foreground">Project</div>
            <div className="truncate font-medium">{session.tenantId}</div>
          </div>
        }
      >
        <Outlet />
      </AppShell>
    </TenantContext.Provider>
  );
}

function AdminLayout({ session }: { session: Session }) {
  const match = matchPath("/admin/t/:tenantId/*", useLocation().pathname);
  const tenantId = match?.params.tenantId;

  const nav: NavGroup[] = [
    {
      label: "Platform",
      items: [
        { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
        { to: "/admin/tenants", label: "Tenants", icon: Building2 },
        { to: "/admin/users", label: "Users", icon: UserPlus },
      ],
    },
  ];
  if (tenantId) {
    nav.push({
      label: tenantId,
      items: tenantNav(`/admin/t/${tenantId}`, tenantId === session.tenantId, false),
    });
  }
  const page = useCurrentLabel(nav);

  const crumbs = tenantId
    ? [
        { label: "Tenants", to: "/admin/tenants" },
        { label: tenantId, to: `/admin/t/${tenantId}` },
        { label: page ?? "" },
      ]
    : [{ label: "Platform", to: "/admin" }, { label: page ?? "" }];

  return (
    <AppShell
      session={session}
      nav={nav}
      crumbs={crumbs}
      switcher={<TenantSwitcher session={session} current={tenantId} />}
    >
      <Outlet />
    </AppShell>
  );
}

function TenantSwitcher({ session, current }: { session: Session; current?: string }) {
  const navigate = useNavigate();
  const { data } = useApi(`topKeys:${session.apiKey}`, () => api.topKeys(session.apiKey));
  const tenants = useMemo(() => {
    const ids = new Set([session.tenantId, ...(current ? [current] : [])]);
    for (const key of data ?? []) if (key.tenantId) ids.add(key.tenantId);
    return [...ids].sort();
  }, [data, current, session.tenantId]);

  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">Project</span>
      <Select
        value={current ?? ""}
        onChange={(e) => navigate(e.target.value ? `/admin/t/${e.target.value}` : "/admin")}
      >
        <option value="">All tenants</option>
        {tenants.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </Select>
    </label>
  );
}

function AdminTenantScope() {
  const { tenantId = "" } = useParams();
  const session = sessionStore.get()!;
  const scope: TenantScope = {
    tenantId,
    session,
    basePath: `/admin/t/${tenantId}`,
    isOwnTenant: tenantId === session.tenantId,
  };
  return (
    <TenantContext.Provider value={scope}>
      <Outlet />
    </TenantContext.Provider>
  );
}
