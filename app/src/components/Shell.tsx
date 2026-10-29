import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SCREEN_LABELS, SCREEN_ORDER, SCREEN_PATHS, isDashboardOnly, useAuth } from '../auth';
import { completeSecurityPrompt } from '../api';
import type { SecurityGate } from '../useSecurityGate';
import SecurityPrompt from './SecurityPrompt';
import NotificationBell from './NotificationBell';
import { ToastProvider } from './Toast';

const TAB_ICON_PATHS: Record<string, ReactNode> = {
  home: (
    <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H10v7H4a1 1 0 0 1-1-1V9.5Z" />
  ),
  dashboard: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V7M17 20v-9" />
    </>
  ),
  base: (
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 17 9 4.5L21 17" />
    </>
  ),
  kanban: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="11" rx="1" />
      <rect x="17" y="4" width="5" height="14" rx="1" />
    </>
  ),
  reports: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
};

const SCREEN_VIEW_PERMISSION: Record<string, string> = {
  kanban: 'kanban.visualizar',
  reports: 'reports.visualizar',
};

function TabIcon({ screen }: { screen: string }) {
  const path = TAB_ICON_PATHS[screen];
  if (!path) return null;
  return (
    <svg
      className="tab-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [securityAsking, setSecurityAsking] = useState(false);
  const projParam = searchParams.get('proj');
  const withProj = (path: string) => (projParam ? `${path}?proj=${projParam}` : path);

  useEffect(() => {
    const onRequired = () => setSecurityAsking(true);
    window.addEventListener('trilho:security-password-required', onRequired);
    return () => window.removeEventListener('trilho:security-password-required', onRequired);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setUserMenuOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [userMenuOpen]);

  if (!user) return null;

  const dashboardOnly = isDashboardOnly(user);
  const tabs = user.profile.screens
    .filter((screen) => {
      if (!SCREEN_PATHS[screen]) return false;
      const viewPermission = SCREEN_VIEW_PERMISSION[screen];
      if (!viewPermission) return true;
      return user.profile.permissions.includes(viewPermission);
    })
    .sort(
      (a, b) =>
        SCREEN_ORDER.indexOf(a) - SCREEN_ORDER.indexOf(b) ||
        SCREEN_LABELS[a].localeCompare(SCREEN_LABELS[b]),
    );

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const avatarInitial = user.name.trim().charAt(0).toUpperCase() || '?';

  const securityGate: SecurityGate = {
    asking: securityAsking,
    message: 'Digite a senha de segurança para liberar esta operação.',
    confirm: async (password: string) => {
      setSecurityAsking(false);
      completeSecurityPrompt(password);
    },
    cancel: () => {
      setSecurityAsking(false);
      completeSecurityPrompt(null);
    },
    guarded: async () => ({ ok: false }),
  };

  return (
    <ToastProvider>
      <div className="shell">
        <header className="appbar">
          <div className="appbar-brand">
            <img className="brand-logo" src="/logo.png" alt="Trilho.app" />
          </div>

          {!dashboardOnly && tabs.length > 1 && (
            <nav className="pill-nav" aria-label="Telas">
              {tabs.map((screen) => (
                <NavLink
                  key={screen}
                  to={withProj(SCREEN_PATHS[screen])}
                  end={SCREEN_PATHS[screen] === '/'}
                >
                  <TabIcon screen={screen} />
                  <span className="pill-label">{SCREEN_LABELS[screen] ?? screen}</span>
                </NavLink>
              ))}
            </nav>
          )}

          <div className="appbar-actions">
            <NotificationBell />
            <div className="user-card">
              <span className="user-meta">
                <span className="user-name">{user.name}</span>
              </span>
              <button
                type="button"
                className="avatar-btn"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Menu do usuário"
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span
                  className="avatar"
                  style={{
                    backgroundColor: user.avatar_color || undefined,
                    color: user.avatar_text_color || undefined,
                  }}
                >
                  {avatarInitial}
                </span>
              </button>
              {userMenuOpen && (
                <>
                  <div
                    className="user-menu-overlay"
                    onClick={() => setUserMenuOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="user-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="user-menu-item"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate(withProj('/configuracoes'));
                      }}
                    >
                      Minha Conta
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="user-menu-item"
                      onClick={() => void handleLogout()}
                    >
                      Sair
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="screen">
          <Outlet />
        </main>
      </div>
      <SecurityPrompt gate={securityGate} />
    </ToastProvider>
  );
}
