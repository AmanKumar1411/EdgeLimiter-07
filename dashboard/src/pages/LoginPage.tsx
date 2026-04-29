import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Field } from "../components/Field";
import { saveSession } from "../auth/session";

export function LoginPage() {
  const navigate = useNavigate();

  const [tenantId, setTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!tenantId.trim() || !apiKey.trim()) {
      setError("Please provide both your Tenant ID and API Key.");
      return;
    }

    setIsLoading(true);

    // Simulating a brief network request for a professional feel
    setTimeout(() => {
      saveSession({
        email: "client@tenant.com",
        role: "client",
        tenantId,
        apiKey,
      });

      setIsLoading(false);
      navigate("/dashboard");
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans selection:bg-blue-500/30">
      {/* Header Section */}
      <div className="sm:mx-auto sm:w-full sm:max-w-md flex flex-col items-center">
        <Badge tone="warning" className="mb-4">
          API Access
        </Badge>
        <h2 className="text-center text-3xl font-semibold tracking-tight text-white">
          EdgeLimiter
        </h2>
        <p className="mt-2 text-center text-sm text-gray-400 max-w-[280px]">
          Enter your credentials to access your protection dashboard.
        </p>
      </div>

      {/* Form Card Section */}
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[420px]">
        <div className="bg-[#111111] py-8 px-6 shadow-2xl border border-white/10 sm:rounded-2xl sm:px-10 relative overflow-hidden">
          {/* Subtle top highlight for depth */}
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <form className="space-y-6" onSubmit={handleSubmit}>
            <Field label="Tenant ID">
              <input
                id="tenantId"
                type="text"
                autoComplete="username"
                className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors sm:text-sm"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="your-tenant-id"
                disabled={isLoading}
              />
            </Field>

            <Field label="API Key">
              <input
                id="apiKey"
                type="password"
                autoComplete="current-password"
                className="block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors sm:text-sm font-mono"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk_live_••••••••"
                disabled={isLoading}
              />
            </Field>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3">
                <p className="text-sm text-red-400 text-center">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full flex justify-center py-2.5"
              disabled={isLoading}
            >
              {isLoading ? "Authenticating..." : "Access Dashboard"}
            </Button>
          </form>
        </div>

        {/* Footer Link */}
        <p className="mt-8 text-center text-sm text-gray-400">
          Don't have an account?{" "}
          <button
            onClick={() => navigate("/register")}
            className="font-medium text-white hover:text-blue-400 transition-colors focus:outline-none focus:underline"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
