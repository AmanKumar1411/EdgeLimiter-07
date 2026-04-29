import { Routes, Route, Navigate } from "react-router-dom";

import { getSession, clearSession } from "./auth/session";

import { LandingPage } from "./pages/LandingPage";
import { RegisterPage } from "./pages/RegisterPage";
import { LoginPage } from "./pages/LoginPage";

import Dashboard from "./Dashboard";
import { AdminDashboard } from "./admin/AdminDashboard";

export default function App() {
  const session = getSession();

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Client Only */}
      <Route
        path="/dashboard"
        element={
          session ? (
            session.role === "client" ? (
              <Dashboard />
            ) : (
              <Navigate to="/admin" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Admin Only */}
      <Route
        path="/admin"
        element={
          session ? (
            session.role === "super_admin" ? (
              <AdminDashboard
                adminEmail={session.email}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
