import { useEffect, useMemo, useState } from "react";

import { Badge } from "../components/Badge";
import { useLocalStorage } from "../hooks/useLocalStorage";

import type { AuditItem } from "../sections/AuditSection";
import { AuditSection } from "../sections/AuditSection";
import { AnalyticsSection } from "../sections/AnalyticsSection";
import { CreatePolicyPanel } from "../sections/CreatePolicyPanel";
import { HeroTester } from "../sections/HeroTester";
import { OperationsSection } from "../sections/OperationsSection";
import { RegisterUserPanel } from "../sections/RegisterUserPanel";

const NAV_ITEMS = [
  { id: "live-control", label: "Live Control" },
  { id: "policies", label: "Policies" },
  { id: "analytics", label: "Analytics" },
  { id: "operations", label: "Operations" },
  { id: "audit", label: "Audit" },
];

type ActivityInput = Omit<AuditItem, "id" | "time">;

type AdminDashboardProps = {
  onLogout: () => void;
  adminEmail: string;
  adminApiKey: string;
};

export function AdminDashboard({
  onLogout,
  adminEmail,
  adminApiKey,
}: AdminDashboardProps) {
  const [tenantId, setTenantId] = useLocalStorage(
    "edge-limiter-tenant",
    "your-tenant-id",
  );

  const [apiKey, setApiKey] = useLocalStorage(
    "edge-limiter-api-key",
    adminApiKey,
  );

  const [activeSection, setActiveSection] = useState(NAV_ITEMS[0].id);

  const [activity, setActivity] = useState<AuditItem[]>([]);

  const activeLabel = useMemo(() => {
    return (
      NAV_ITEMS.find((item) => item.id === activeSection)?.label ??
      NAV_ITEMS[0].label
    );
  }, [activeSection]);

  const handleActivity = (entry: ActivityInput) => {
    setActivity((prev) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const next = [
        {
          ...entry,
          id,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ];

      return next.slice(0, 8);
    });
  };

  const handleNavClick = (id: string) => {
    setActiveSection(id);

    const target = document.getElementById(id);

    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  };

  useEffect(() => {
    const sections = NAV_ITEMS.map((item) =>
      document.getElementById(item.id),
    ).filter((section): section is HTMLElement => Boolean(section));

    if (!sections.length) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target instanceof HTMLElement) {
          setActiveSection(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0.1, 0.4, 0.6],
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EL</div>

          <div>
            <div className="brand-title">EdgeLimiter</div>

            <div className="brand-subtitle">Admin Control Plane</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${
                activeSection === item.id ? "active" : ""
              }`}
              type="button"
              onClick={() => handleNavClick(item.id)}
              aria-current={activeSection === item.id ? "page" : undefined}
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

            <div className="topbar-sub">Admin: {adminEmail}</div>
          </div>

          <button
            className="button button-outline button-sm"
            onClick={onLogout}
          >
            Log out
          </button>
        </header>

        <main className="content">
          <HeroTester
            tenantId={tenantId}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            onActivity={handleActivity}
          />

          <section id="policies" className="section section-anchor">
            <div className="section-head">
              <div>
                <h2>Policy Control</h2>

                <p>Provision client access and configure rate limits.</p>
              </div>

              <Badge tone="info">Policies</Badge>
            </div>

            <div className="panel-grid">
              <RegisterUserPanel
                onApiKey={setApiKey}
                onActivity={handleActivity}
              />

              <CreatePolicyPanel
                tenantId={tenantId}
                onTenantIdChange={setTenantId}
                onActivity={handleActivity}
              />
            </div>
          </section>

          <AnalyticsSection />

          <OperationsSection
            onActivity={handleActivity}
            resetCounter={{
              tenantId,
              onTenantIdChange: setTenantId,
              apiKey: adminApiKey,
            }}
          />

          <AuditSection activity={activity} />
        </main>
      </div>
    </div>
  );
}
