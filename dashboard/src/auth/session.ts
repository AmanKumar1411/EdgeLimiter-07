import type { LoginResponse } from "../types/api";

const SESSION_KEY = "edge-limiter-session";

export type AuthSession = {
  email: string;
  role: LoginResponse["role"];
  tenantId: string;
  apiKey: string;
};

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession;

    if (
      !parsed?.email ||
      !parsed?.role ||
      !parsed?.tenantId ||
      !parsed?.apiKey
    ) {
      clearSession();
      return null;
    }

    return parsed;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(
  session: AuthSession
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(session)
  );
}

export function clearSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(SESSION_KEY);
}

export function isAuthenticated(): boolean {
  return !!getSession();
}