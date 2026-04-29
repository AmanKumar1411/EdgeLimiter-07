import { useState } from "react";

import { Button } from "./Button";

type CopyFieldProps = {
  value: string;
  label?: string;
};

export function CopyField({ value, label }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="copy-field">
      {label ? <span className="copy-label">{label}</span> : null}
      <div className="copy-row">
        <div className="copy-value">{value || "No key yet"}</div>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
