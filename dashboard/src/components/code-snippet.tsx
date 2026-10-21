import { useState } from "react";
import { CopyButton } from "./ui/copy-button";
import { API_BASE } from "@/lib/api";
import { cn, maskKey } from "@/lib/format";

function snippets(tenantId: string, route: string, apiKey: string) {
  const build = (key: string) => ({
    curl: [
      `curl -X POST ${API_BASE}/check \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-api-key: ${key}" \\`,
      `  -d '{"tenantId":"${tenantId}","route":"${route}"}'`,
    ].join("\n"),
    js: [
      `const res = await fetch("${API_BASE}/check", {`,
      `  method: "POST",`,
      `  headers: { "Content-Type": "application/json", "x-api-key": "${key}" },`,
      `  body: JSON.stringify({ tenantId: "${tenantId}", route: "${route}" }),`,
      `});`,
      ``,
      `if (res.status === 429) {`,
      `  // Over the limit: reject the request and tell the caller when to retry.`,
      `  const retryAfter = res.headers.get("Retry-After");`,
      `}`,
    ].join("\n"),
  });
  const shown = build(maskKey(apiKey));
  const copied = build(apiKey);
  return [
    { label: "curl", display: shown.curl, copy: copied.curl },
    { label: "JavaScript", display: shown.js, copy: copied.js },
  ];
}

/** Ready-to-run /check call. Shows a masked key but copies the real one. */
export function CheckSnippet({ tenantId, route, apiKey }: { tenantId: string; route: string; apiKey: string }) {
  const [active, setActive] = useState(0);
  const tabs = snippets(tenantId, route, apiKey);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <div role="tablist" aria-label="Snippet language" className="flex gap-1">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "rounded px-2 py-1 text-xs",
                i === active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton value={tabs[active].copy} label="Copy snippet" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
        <code>{tabs[active].display}</code>
      </pre>
    </div>
  );
}
