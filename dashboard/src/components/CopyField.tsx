import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyFieldProps {
  value: string;
  className?: string;
  label?: string;
}

export function CopyField({ value, className, label }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>}
      <div className="flex items-center gap-2 rounded-lg border border-border/10 bg-muted/40 px-3 py-2.5">
        <code className="flex-1 truncate font-mono text-sm text-foreground">{value}</code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy to clipboard"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
