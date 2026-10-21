// One JSON line per event, so Workers Logs / Logpush can filter on fields.
function write(level: "info" | "error", event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => write("info", event, fields),
  error: (event: string, error: unknown, fields: Record<string, unknown> = {}) =>
    write("error", event, { ...fields, error: String(error) }),
};
