import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "@/lib/format";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-muted", className)} />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** An error with what to do next; `onRetry` adds a retry button. */
export function ErrorMessage({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Confirmation that an action worked. */
export function SuccessMessage({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded border border-success/30 bg-success/5 px-3 py-2.5 text-sm">
      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
      {message}
    </div>
  );
}
