import type { BadgeTone } from "../components/Badge";
import { Badge } from "../components/Badge";

export type AuditItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone?: BadgeTone;
};

type AuditSectionProps = {
  activity: AuditItem[];
};

export function AuditSection({ activity }: AuditSectionProps) {
  return (
    <section id="audit" className="section section-anchor">
      <div className="section-head">
        <div>
          <h2>Audit</h2>
          <p>Recent control plane actions captured this session.</p>
        </div>
        <Badge tone="neutral">Session log</Badge>
      </div>

      <section className="panel">
        {activity.length ? (
          <div className="activity-list">
            {activity.map((item) => (
              <div key={item.id} className="activity-item">
                <div className="activity-meta">
                  <Badge tone={item.tone ?? "neutral"}>{item.title}</Badge>
                  <span className="timestamp">{item.time}</span>
                </div>
                <div className="activity-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="notice">
            Activity will appear after running checks, issuing keys, or updating
            policies.
          </div>
        )}
      </section>
    </section>
  );
}
