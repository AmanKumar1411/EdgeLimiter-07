import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  tone?: "primary" | "secondary" | "success" | "warning" | "danger" | "muted";
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({ children, tone = "primary", pulse, className }: BadgeProps) {
  const tones: Record<string, string> = {
    primary: "bg-primary/10 text-primary border-primary/30",
    secondary: "bg-secondary/10 text-secondary border-secondary/30",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    danger: "bg-destructive/10 text-destructive border-destructive/40",
    muted: "bg-muted/40 text-muted-foreground border-border/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium tracking-wide uppercase rounded-full border",
        tones[tone],
        className,
      )}
    >
      {pulse && (
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full pulse-live",
            tone === "success" ? "bg-success" : tone === "danger" ? "bg-destructive" : "bg-primary",
          )}
        />
      )}
      {children}
    </span>
  );
}
