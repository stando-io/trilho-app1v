import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { homePathFor, useAuth } from './auth';
import Shell from './components/Shell';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import ResetPassword from './pages/ResetPassword';
import ForgotPassword from './pages/ForgotPassword';
import ProjectPicker from './pages/ProjectPicker';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Base from './pages/Base';
import Kanban from './pages/Kanban';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

function Loading() {
  return (
    <div className="center-page">
      <p>Carregando</p>
    </div>
  );
}

function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(user)} replace />;
}

function GuardedScreen({
  screen,
  permission,
  children,
}: {
  screen: string;
  permission?: string;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.profile.screens.includes(screen)) {
    return (
      <div className="notice">
        <h1>Sem acesso a esta tela</h1>
        <p>Seu perfil não inclui esta tela. Fale com o administrador para receber acesso.</p>
      </div>
    );
  }
  if (permission && !user.profile.permissions.includes(permission)) {
    return (
      <div className="notice">
        <h1>Sem permissão para esta ação</h1>
        <p>Seu perfil não tem permissão para esta ação. Fale com o administrador.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/convite/:token" element={<AcceptInvite />} />
      <Route path="/redefinir/:token" element={<ResetPassword />} />
      <Route path="/esqueci-minha-senha" element={<ForgotPassword />} />

      <Route
        path="/escolher-projeto"
        element={
          <RequireUser>
            <ProjectPicker />
          </RequireUser>
        }
      />

      <Route
        path="/"
        element={
          <RequireUser>
            <Shell />
          </RequireUser>
        }
      >
        <Route
          index
          element={
            <GuardedScreen screen="home">
              <Home />
            </GuardedScreen>
          }
        />
        <Route
          path="dashboard"
          element={
            <GuardedScreen screen="dashboard">
              <Dashboard />
            </GuardedScreen>
          }
        />
        <Route
          path="base"
          element={
            <GuardedScreen screen="base">
              <Base />
            </GuardedScreen>
          }
        />
        <Route
          path="kanban"
          element={
            <GuardedScreen screen="kanban" permission="kanban.visualizar">
              <Kanban />
            </GuardedScreen>
          }
        />
        <Route
          path="relatorios"
          element={
            <GuardedScreen screen="reports" permission="reports.visualizar">
              <Reports />
            </GuardedScreen>
          }
        />
        <Route
          path="configuracoes"
          element={
            <GuardedScreen screen="settings">
              <Settings />
            </GuardedScreen>
          }
        />
      </Route>

      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}
