import { ChevronRight, LogOut, Menu, Monitor, Moon, Sun, X, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { api, loginPath, sessionStore, type Session } from "@/lib/api";
import { cn } from "@/lib/format";
import { useTheme, type Theme } from "@/lib/theme";
import { useApi } from "@/lib/use-api";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Only active on an exact match (index pages). */
  end?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface Crumb {
  label: string;
  to?: string;
}

export function AppShell({
  session,
  nav,
  switcher,
  crumbs,
  children,
}: {
  session: Session;
  nav: NavGroup[];
  switcher: ReactNode;
  crumbs: Crumb[];
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  // Close the mobile drawer whenever the page changes.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const sidebar = <Sidebar session={session} nav={nav} switcher={switcher} />;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 border-r bg-card">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X />
            </Button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 lg:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
          <Breadcrumbs crumbs={crumbs} />
          <div className="ml-auto flex items-center gap-1">
            <ApiStatus />
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ session, nav, switcher }: { session: Session; nav: NavGroup[]; switcher: ReactNode }) {
  const navigate = useNavigate();

  function signOut() {
    sessionStore.clear();
    navigate(loginPath(session.role));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <span className="flex size-6 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground">
          EL
        </span>
        <span className="font-semibold">EdgeLimiter</span>
      </div>
      <div className="p-3">{switcher}</div>
      <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {nav.map((group, i) => (
          <div key={group.label ?? i}>
            {group.label && (
              <div className="truncate px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2 rounded px-2 py-1.5",
                        isActive
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    <item.icon className="size-4" aria-hidden />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t p-3">
        <div className="truncate px-2 text-xs text-muted-foreground" title={session.email}>
          {session.email}
        </div>
        <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={signOut}>
          <LogOut aria-hidden />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={i} className={cn("flex min-w-0 items-center gap-1", !last && "hidden sm:flex")}>
              {crumb.to && !last ? (
                <Link to={crumb.to} className="truncate text-muted-foreground hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn("truncate", last ? "font-medium" : "text-muted-foreground")}>{crumb.label}</span>
              )}
              {!last && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ApiStatus() {
  const { error, loading, data } = useApi(`health`, () => api.health(), 60_000);
  const state = error ? "down" : data ? "up" : loading ? "checking" : "down";
  return (
    <span
      className="hidden items-center gap-1.5 px-2 text-xs text-muted-foreground sm:flex"
      title={error ?? "GET /health"}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          state === "up" ? "bg-success" : state === "down" ? "bg-danger" : "bg-muted-foreground",
        )}
      />
      {state === "up" ? "API online" : state === "down" ? "API unreachable" : "Checking API"}
    </span>
  );
}

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
];

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const index = THEMES.findIndex((t) => t.value === theme);
  const current = THEMES[index];
  const next = THEMES[(index + 1) % THEMES.length];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next.value)}
      aria-label={`${current.label}. Switch to ${next.label.toLowerCase()}`}
      title={current.label}
    >
      <current.icon />
    </Button>
  );
}
