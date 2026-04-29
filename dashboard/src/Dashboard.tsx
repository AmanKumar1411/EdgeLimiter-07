import { useMemo, useState } from "react";

import { Badge } from "./components/Badge";
import { HeroTester } from "./sections/HeroTester";
import { CreatePolicyPanel } from "./sections/CreatePolicyPanel";
import { AnalyticsSection } from "./sections/AnalyticsSection";
import { OperationsSection } from "./sections/OperationsSection";
import { AuditSection } from "./sections/AuditSection";
import SecurityIntelligencePanel from "./components/SecurityIntelligencePanel";
import type { AuditItem } from "./sections/AuditSection";
import { clearSession, getSession } from "./auth/session";

const NAV_ITEMS = [
  { id: "live-control", label: "Live Control" },
  { id: "policies", label: "Policies" },
  { id: "analytics", label: "Analytics" },
  { id: "operations", label: "Operations" },
  { id: "audit", label: "Audit" },
];

type ActivityInput = Omit<AuditItem, "id" | "time">;

export default function Dashboard() {
  const session = getSession();

  const [tenantId, setTenantId] = useState(session?.tenantId || "company-a");

  const [apiKey, setApiKey] = useState(session?.apiKey || "");

  const [activeSection, setActiveSection] = useState(NAV_ITEMS[0].id);

  const [activity, setActivity] = useState<AuditItem[]>([]);

  const activeLabel = useMemo(() => {
    return (
      NAV_ITEMS.find((item) => item.id === activeSection)?.label || "Dashboard"
    );
  }, [activeSection]);

  const handleActivity = (entry: ActivityInput) => {
    setActivity((prev) => {
      const next = [
        {
          ...entry,
          id: `${Date.now()}`,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ];

      return next.slice(0, 8);
    });
  };

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EL</div>
          <div>
            <div className="brand-title">EdgeLimiter</div>
            <div className="brand-subtitle">Client Portal</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${
                activeSection === item.id ? "active" : ""
              }`}
              onClick={() => setActiveSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="status-card">
            <span>Edge Status</span>
            <Badge tone="success">Live</Badge>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{activeLabel}</div>
            <div className="topbar-sub">Tenant: {tenantId}</div>
          </div>

          <button
            className="button button-outline button-sm"
            onClick={handleLogout}
          >
            Logout
          </button>
        </header>

        <main className="content">
          <HeroTester
            tenantId={tenantId}
            onTenantIdChange={setTenantId}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            onActivity={handleActivity}
          />

          <section id="policies" className="section">
            <CreatePolicyPanel
              tenantId={tenantId}
              onTenantIdChange={setTenantId}
              onActivity={handleActivity}
            />
          </section>

          <AnalyticsSection />
          <SecurityIntelligencePanel />
          <OperationsSection onActivity={handleActivity} />
          <AuditSection activity={activity} />
        </main>
      </div>
    </div>
  );
}
