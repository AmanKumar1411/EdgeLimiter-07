import { useCallback, useEffect, useState } from "react";

import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { fetchMetrics, fetchTopKeys } from "../lib/api";
import type { MetricsResponse, TopKey } from "../types/api";

type LoadState = "idle" | "loading" | "success" | "error";

const formatNumber = (value: number | undefined) => {
  if (value === undefined) {
    return "--";
  }
  return value.toLocaleString();
};

export function AnalyticsSection() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [topKeys, setTopKeys] = useState<TopKey[]>([]);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const [metricsData, topKeyData] = await Promise.all([
        fetchMetrics(),
        fetchTopKeys(),
      ]);
      setMetrics(metricsData);
      setTopKeys(topKeyData);
      setStatus("success");
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load analytics.";
      setError(message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  return (
    <section id="analytics" className="section section-anchor">
      <div className="section-head">
        <div>
          <h2>Analytics</h2>
          <p>Traffic volume and abuse signals across the edge.</p>
        </div>
        <div className="section-actions">
          {lastUpdated ? (
            <span className="timestamp">Updated {lastUpdated}</span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={loadAnalytics}
            loading={status === "loading"}
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="panel-grid">
        <section className="panel span-6">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">Traffic Summary</h3>
              <p>Edge request totals and block rate.</p>
            </div>
            <Badge tone="info">Live</Badge>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">Total Requests</div>
              <div className="metric-value">
                {formatNumber(metrics?.totalRequests)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Blocked Requests</div>
              <div className="metric-value">
                {formatNumber(metrics?.blockedRequests)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Block Rate</div>
              <div className="metric-value">{metrics?.blockRate ?? "--"}</div>
            </div>
          </div>
          {status === "error" && error ? (
            <div className="notice notice-error">{error}</div>
          ) : null}
        </section>

        <section className="panel span-6">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">Top API Keys</h3>
              <p>Highest blocked volume in the last window.</p>
            </div>
            <Badge tone="warning">Monitor</Badge>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>API Key</th>
                  <th>Total</th>
                  <th>Blocked</th>
                  <th>Abuse Score</th>
                </tr>
              </thead>
              <tbody>
                {topKeys.length ? (
                  topKeys.map((key) => (
                    <tr key={key.apiKey}>
                      <td className="table-key">{key.apiKey}</td>
                      <td>{formatNumber(key.totalRequests)}</td>
                      <td>{formatNumber(key.blockedRequests)}</td>
                      <td>{key.abuseScore}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="table-empty" colSpan={4}>
                      No traffic data captured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
