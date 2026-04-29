import { Link } from "react-router-dom";
import { ArrowRight, Shield } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";

export default function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl glass-card p-10 md:p-14 animate-fade-in-up relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-glow pointer-events-none" />
        <div className="relative space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-primary flex items-center justify-center glow-primary">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            <StatusBadge tone="primary" pulse>
              Distributed Security
            </StatusBadge>
          </div>

          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
              <span className="text-gradient">EdgeLimiter</span>
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
              Protect APIs globally with durable, edge-native rate limiting and
              security-first access control. Enforce per-tenant policies across
              the world in milliseconds.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold hover:brightness-110 hover:shadow-glow-primary transition-all duration-200"
            >
              Login
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/register"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 text-primary px-6 py-3 font-semibold hover:bg-primary/10 transition-all duration-200"
            >
              Register
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-border/10">
            {[
              { label: "Edge POPs", value: "300+" },
              { label: "p99 Latency", value: "<10ms" },
              { label: "Algorithms", value: "3" },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-2xl font-bold text-foreground">
                  {s.value}
                </div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
