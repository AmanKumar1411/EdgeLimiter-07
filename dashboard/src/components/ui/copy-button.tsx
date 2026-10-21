import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "./button";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button size="sm" onClick={copy} aria-live="polite">
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A secret shown once, with a copy button. */
export function SecretValue({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2 rounded border bg-muted/50 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
