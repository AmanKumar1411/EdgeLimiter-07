import { useSyncExternalStore } from "react";

export type ActivityTone = "success" | "warning" | "danger" | "info";

export interface ActivityItem {
  id: string;
  title: string;
  detail: string;
  tone: ActivityTone;
  timestamp: number;
}

let items: ActivityItem[] = [];
const listeners = new Set<() => void>();

export function logActivity(entry: Omit<ActivityItem, "id" | "timestamp">) {
  const item: ActivityItem = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  items = [item, ...items].slice(0, 8);
  listeners.forEach((l) => l());
}

export function useActivity(): ActivityItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => items,
  );
}

export function formatRelative(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleTimeString();
}
