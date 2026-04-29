import { useNavigate } from "react-router-dom";

import { Button } from "../components/Button";

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="auth-shell">
      <section className="auth-card auth-hero">
        <div className="eyebrow">Distributed Security</div>

        <h1>EdgeLimiter</h1>

        <p className="auth-description">
          Protect APIs globally with durable, edge-native rate limiting.
        </p>

        <div className="auth-actions">
          <Button onClick={() => navigate("/login")}>Login</Button>

          <Button variant="outline" onClick={() => navigate("/register")}>
            Register
          </Button>
        </div>
      </section>
    </div>
  );
}
