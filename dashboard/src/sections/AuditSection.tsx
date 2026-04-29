import { useActivity, formatRelative } from "../lib/activity";
import { StatusBadge } from "../components/StatusBadge";
import { ScrollText } from "lucide-react";

export function AuditSection() {
  const items = useActivity();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Activity Log</h2>
        <p className="text-muted-foreground">
          Recent policy and control actions.
        </p>
      </header>

      <div className="glass-card p-6">
        {items.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-12 flex flex-col items-center gap-3">
            <ScrollText className="h-8 w-8 opacity-40" />
            No activity yet. Run a check or create a policy to populate this
            log.
          </div>
        ) : (
          <ul className="divide-y divide-border/10">
            {items.map((item) => {
              const tone =
                item.tone === "success"
                  ? "success"
                  : item.tone === "danger"
                    ? "danger"
                    : item.tone === "warning"
                      ? "warning"
                      : "primary";
              return (
                <li
                  key={item.id}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-white/5 -mx-2 px-2 rounded-md transition-colors"
                >
                  <div className="min-w-0 flex-1 flex items-center gap-3">
                    <StatusBadge tone={tone}>{item.tone}</StatusBadge>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {formatRelative(item.timestamp)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
