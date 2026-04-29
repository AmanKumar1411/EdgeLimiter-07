import { Navigate } from "react-router-dom";

import { sessionStore } from "@/lib/api";

export default function AdminDashboard() {
  const session = sessionStore.get();

  if (!session || session.role !== "super_admin") {
    return <Navigate to="/admin-login" replace />;
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <section className="mx-auto max-w-4xl glass-card p-8 md:p-10">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="mt-3 text-muted-foreground">
          Super admin session for tenant{" "}
          <span className="font-mono">{session.tenantId}</span> is active.
        </p>
      </section>
    </main>
  );
}
