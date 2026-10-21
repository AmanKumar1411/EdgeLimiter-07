import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormat = new Intl.NumberFormat();

export function formatNumber(value: number) {
  return numberFormat.format(value);
}

// D1's CURRENT_TIMESTAMP is UTC without a zone ("YYYY-MM-DD HH:MM:SS").
export function parseTimestamp(value: string) {
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
}

export function formatDateTime(value: string) {
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatTime(value: string) {
  return parseTimestamp(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function maskKey(key: string) {
  return key.length > 16 ? `${key.slice(0, 12)}••••${key.slice(-4)}` : "••••••••";
}
