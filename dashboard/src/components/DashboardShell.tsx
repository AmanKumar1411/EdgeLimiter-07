import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Activity, Settings, BarChart3, Wrench, ScrollText, Shield, UserPlus, ShieldAlert, Menu, X } from "lucide-react";
import { sessionStore, type Session } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  label: string;
  icon: typeof Activity;
}

export const CLIENT_NAV: NavItem[] = [
  { id: "live", label: "Live Control", icon: Activity },
  { id: "policies", label: "Policies", icon: Settings },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "operations", label: "Operations", icon: Wrench },
  { id: "security", label: "Security" , icon: Shield },
  { id: "audit", label: "Audit", icon: ScrollText },
];

export const ADMIN_NAV: NavItem[] = [
  ...CLIENT_NAV,
  { id: "register", label: "Register User", icon: UserPlus },
  { id: "security", label: "Security Intel", icon: ShieldAlert },
];

interface DashboardShellProps {
  session: Session;
  nav: NavItem[];
  active: string;
  onActiveChange: (id: string) => void;
  portalLabel: string;
  children: ReactNode;
}

export function DashboardShell({
  session,
  nav,
  active,
  onActiveChange,
  portalLabel,
  children,
}: DashboardShellProps) {
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeItem = nav.find((n) => n.id === active);

  function handleLogout() {
    sessionStore.clear();
    navigate("/");
  }

  return (
    <div className="min-h-screen flex w-full">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-40 w-[280px] glass-card rounded-none lg:rounded-r-2xl border-l-0 border-y-0 lg:border-y border-r border-border/10 flex flex-col transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="p-6 border-b border-border/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center font-bold text-primary-foreground glow-primary">
              EL
            </div>
            <div>
              <div className="font-bold text-foreground">EdgeLimiter</div>
              <div className="text-xs text-muted-foreground">{portalLabel}</div>
            </div>
          </div>
          <button
            className="lg:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onActiveChange(item.id);
                  setMobileOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-left",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/10">
          <div className="glass-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                Edge Status
              </span>
              <StatusBadge tone="success" pulse>
                Live
              </StatusBadge>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              All POPs healthy
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-background/70 backdrop-blur-xl border-b border-border/10 px-4 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="lg:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                {portalLabel}
              </div>
              <h1 className="text-lg font-semibold truncate">{activeItem?.label}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Tenant:</span>
              <code className="font-mono text-primary">{session.tenantId}</code>
            </div>
            <button onClick={handleLogout} className="btn-outline !py-2 !px-3 text-sm">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          <div key={active} className="animate-fade-in-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
