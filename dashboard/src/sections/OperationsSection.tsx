import { useState } from "react";

import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { runReport } from "../lib/api";
import type { RunReportResponse } from "../types/api";
import { ResetCounterPanel } from "./ResetCounterPanel";

type OperationsSectionProps = {
  onActivity?: (entry: {
    title: string;
    detail: string;
    tone?: BadgeTone;
  }) => void;
  resetCounter?: {
    tenantId: string;
    onTenantIdChange: (value: string) => void;
    apiKey: string;
  };
};

type LoadState = "idle" | "loading" | "success" | "error";

const getRecommendationTone = (
  recommendation: string | undefined,
): BadgeTone => {
  if (!recommendation) {
    return "neutral";
  }

  const value = recommendation.toLowerCase();

  if (value.includes("block")) {
    return "danger";
  }

  if (value.includes("monitor")) {
    return "warning";
  }

  return "info";
};

export function OperationsSection({
  onActivity,
  resetCounter,
}: OperationsSectionProps) {
  const [report, setReport] = useState<RunReportResponse | null>(null);

  const [status, setStatus] = useState<LoadState>("idle");

  const [error, setError] = useState<string | null>(null);

  const [lastRun, setLastRun] = useState<string | null>(null);

  const handleRunReport = async () => {
    setStatus("loading");
    setError(null);

    try {
      const data = await runReport();

      setReport(data);
      setLastRun(new Date().toLocaleTimeString());
      setStatus("success");

      onActivity?.({
        title: "Abuse report generated",
        detail: data.topApiKey,
        tone: getRecommendationTone(data.recommendation),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Report run failed.";

      setError(message);
      setStatus("error");
    }
  };

  const reportPanel = (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Daily Abuse Report</h3>

          <p>Investigate the highest-risk API key detected today.</p>
        </div>

        <Badge tone="warning">Ops</Badge>
      </div>

      {status === "error" && error ? (
        <div className="notice notice-error">{error}</div>
      ) : null}

      {report ? (
        <div className="detail-grid">
          <div className="detail-card">
            <div className="detail-label">Top API Key</div>

            <div className="detail-value detail-key">{report.topApiKey}</div>
          </div>

          <div className="detail-card">
            <div className="detail-label">Total Requests</div>

            <div className="detail-value">{report.totalRequests}</div>
          </div>

          <div className="detail-card">
            <div className="detail-label">Blocked Requests</div>

            <div className="detail-value">{report.blockedRequests}</div>
          </div>

          <div className="detail-card">
            <div className="detail-label">Abuse Score</div>

            <div className="detail-value">{report.abuseScore}</div>
          </div>

          <div className="detail-card span-12">
            <div className="detail-label">Recommendation</div>

            <div className="detail-value">
              <Badge tone={getRecommendationTone(report.recommendation)}>
                {report.recommendation}
              </Badge>
            </div>
          </div>
        </div>
      ) : (
        <div className="notice">
          Run the report to surface the most abusive API key today.
        </div>
      )}
    </section>
  );

  return (
    <section id="operations" className="section section-anchor">
      <div className="section-head">
        <div>
          <h2>Operations</h2>

          <p>
            Run abuse analysis, security intelligence, and emergency recovery
            actions.
          </p>
        </div>

        <div className="section-actions">
          {lastRun ? (
            <span className="timestamp">Last run {lastRun}</span>
          ) : null}

          <Button onClick={handleRunReport} loading={status === "loading"}>
            Run Abuse Report
          </Button>
        </div>
      </div>

      {resetCounter ? (
        <div className="panel-grid">
          {reportPanel}

          <ResetCounterPanel
            tenantId={resetCounter.tenantId}
            onTenantIdChange={resetCounter.onTenantIdChange}
            apiKey={resetCounter.apiKey}
            onActivity={onActivity}
          />
        </div>
      ) : (
        reportPanel
      )}
    </section>
  );
}
