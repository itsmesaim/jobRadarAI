import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queryClient";
import { Toaster } from "react-hot-toast";
import { LoginPage } from "./pages/Login";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { Dashboard } from "./pages/Dashboard";
import { KanbanPage } from "./pages/Kanban";
import { SettingsPage } from "./pages/Settings";
import { AdminPage } from "./pages/Admin";
import { Navbar } from "./components/Navbar";
import { WelcomeModal } from "./components/WelcomeModal";
import { useAuthStore } from "./hooks/useStores";
import { authApi } from "./api";
import { useEffect } from "react";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        overflowX: "hidden",
      }}
    >
      <Navbar />
      <main style={{ overflowX: "hidden" }}>{children}</main>
      <WelcomeModal />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { token, setUser, user } = useAuthStore();

  useEffect(() => {
    if (token && !user) {
      authApi
        .me()
        .then(setUser)
        .catch(() => {});
    }
  }, [token, user, setUser]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* <BrowserRouter> */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="/kanban"
            element={
              <Protected>
                <KanbanPage />
              </Protected>
            }
          />
          <Route
            path="/settings"
            element={
              <Protected>
                <SettingsPage />
              </Protected>
            }
          />
          <Route
            path="/admin"
            element={
              <Protected>
                <AdminPage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-center"
        containerStyle={{ top: 72 }}
        toastOptions={{
          style: {
            background: "var(--bg-card)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            fontSize: 13,
            boxShadow: "var(--shadow-md)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
