import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-6 py-10">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/90 shadow-2xl p-10 text-center">
        <div className="inline-flex rounded-full border border-slate-700 px-4 py-1 text-sm text-slate-300 mb-6">
          Distributed Security
        </div>

        <h1 className="text-5xl font-bold text-white tracking-tight mb-4">
          EdgeLimiter
        </h1>

        <p className="text-slate-300 text-lg leading-relaxed max-w-xl mx-auto mb-10">
          Protect APIs globally with durable, edge-native rate limiting and
          security-first access control.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button onClick={() => navigate("/login")}>Login</Button>

          <Button variant="outline" onClick={() => navigate("/register")}>
            Register
          </Button>
        </div>
      </section>
    </div>
  );
}
