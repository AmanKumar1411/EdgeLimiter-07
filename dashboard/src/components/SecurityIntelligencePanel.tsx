import { useEffect, useState } from "react";
import { getSession } from "../auth/session";

type SecurityLog = {
  id: number;
  route: string;
  ipAddress: string;
  country: string;
  allowed: boolean;
  reason: string | null;
  createdAt: string;
};

type TopIp = {
  ipAddress: string;
  country: string;
  totalRequests: number;
  blockedRequests: number;
};

type SecurityReport = {
  recentLogs: SecurityLog[];
  topAbusiveIps: TopIp[];
  aiSummary: string;
  abuseScore: string;
  recommendation: string;
};

export default function SecurityIntelligencePanel() {
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSecurityReport() {
      const session = getSession();

      if (!session) return;

      try {
        const response = await fetch(
          `https://edge-limiter.edgeaman.workers.dev/security-report?tenantId=${session.tenantId}`,
          {
            headers: {
              "x-api-key": session.apiKey,
            },
          }
        );

        const data = await response.json();
        setReport(data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    }

    fetchSecurityReport();
  }, []);

  if (loading) {
    return <div className="panel">Loading security intelligence...</div>;
  }

  if (!report) {
    return <div className="panel">Failed to load security report.</div>;
  }

  return (
    <section className="panel">
      <h2>Security Intelligence</h2>

      <div style={{ marginTop: 20 }}>
        <h3>AI Summary</h3>
        <p><strong>Abuse Score:</strong> {report.abuseScore}</p>
        <p>{report.recommendation}</p>
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Top Abusive IPs</h3>
        {report.topAbusiveIps.map((ip) => (
          <div key={ip.ipAddress} className="mini-card">
            <p><strong>{ip.ipAddress}</strong> ({ip.country})</p>
            <p>Total Requests: {ip.totalRequests}</p>
            <p>Blocked Requests: {ip.blockedRequests}</p>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <h3>Recent Security Logs</h3>
        {report.recentLogs.slice(0, 5).map((log) => (
          <div key={log.id} className="mini-card">
            <p><strong>{log.route}</strong></p>
            <p>IP: {log.ipAddress}</p>
            <p>Status: {log.allowed ? "Allowed" : "Blocked"}</p>
            <p>Reason: {log.reason || "Normal traffic"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}