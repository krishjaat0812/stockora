import { useEffect } from 'react';
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/toast';
import { AppLayout } from './components/layout/AppLayout';
import { Button, Card, EmptyState } from './components/ui';
import { AuthProvider } from './auth/AuthContext';
import { FeatureGate, RequireAdmin, RequireAuth, RequireClient } from './auth/guards';
import { StockoraProvider } from './store/StockoraContext';
import OverviewPage from './pages/OverviewPage';
import InventoryPage from './pages/InventoryPage';
import ActionsPage from './pages/ActionsPage';
import ExpiryPage from './pages/ExpiryPage';
import ReorderPage from './pages/ReorderPage';
import ReportsPage from './pages/ReportsPage';
import SuppliersPage from './pages/SuppliersPage';
import DemandPage from './pages/DemandPage';
import CalculatorPage from './pages/CalculatorPage';
import SettingsPage from './pages/SettingsPage';
import SecurityPage from './pages/SecurityPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import InvitePage from './pages/InvitePage';
import { AdminLayout } from './admin/AdminLayout';
import AdminDashboard from './admin/AdminDashboard';
import ClientsPage from './admin/ClientsPage';
import ClientDetailPage from './admin/ClientDetailPage';
import FeatureAccessPage from './admin/FeatureAccessPage';
import AdminSecurityPage from './admin/AdminSecurityPage';
import AuditLogsPage from './admin/AuditLogsPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

function NotFoundPage() {
  return (
    <Card className="p-5">
      <EmptyState
        icon={<span className="text-lg font-bold">?</span>}
        title="Page not found"
        description="That page does not exist in Stockora. Use the navigation to return to the dashboard."
        action={
          <Link to="/">
            <Button>Back to overview</Button>
          </Link>
        }
      />
    </Card>
  );
}

/** Shell for the client panel: session + role + feature guards, then layout. */
function ClientShell() {
  return (
    <RequireAuth>
      <RequireClient>
        <StockoraProvider>
          <AppLayout>
            <Outlet />
          </AppLayout>
        </StockoraProvider>
      </RequireClient>
    </RequireAuth>
  );
}

/** Shell for the admin panel: session + administrator role only. */
function AdminShell() {
  return (
    <RequireAuth>
      <RequireAdmin>
        <AdminLayout>
          <Outlet />
        </AdminLayout>
      </RequireAdmin>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <AuthProvider>
          <ScrollToTop />
          <Routes>
            {/* Public authentication pages */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />

            {/* Admin panel */}
            <Route element={<AdminShell />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/clients" element={<ClientsPage />} />
              <Route path="/admin/clients/:id" element={<ClientDetailPage />} />
              <Route path="/admin/features" element={<FeatureAccessPage />} />
              <Route path="/admin/security" element={<AdminSecurityPage />} />
              <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            </Route>

            {/* Client panel — every page gated by its feature permission */}
            <Route element={<ClientShell />}>
              <Route
                path="/"
                element={
                  <FeatureGate feature="dashboard">
                    <OverviewPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/inventory"
                element={
                  <FeatureGate feature="inventory">
                    <InventoryPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/actions"
                element={
                  <FeatureGate feature="action_center">
                    <ActionsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/expiry"
                element={
                  <FeatureGate feature="expiry_monitor">
                    <ExpiryPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/reorder"
                element={
                  <FeatureGate feature="reorder_planner">
                    <ReorderPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/reports"
                element={
                  <FeatureGate feature="reports">
                    <ReportsPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/suppliers"
                element={
                  <FeatureGate feature="suppliers">
                    <SuppliersPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/demand"
                element={
                  <FeatureGate feature="demand_analytics">
                    <DemandPage />
                  </FeatureGate>
                }
              />
              <Route
                path="/calculator"
                element={
                  <FeatureGate feature="business_calculator">
                    <CalculatorPage />
                  </FeatureGate>
                }
              />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
