import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { MeUser } from './types';

interface AuthContextValue {
  user: MeUser | null;
  loading: boolean;
  refresh: () => Promise<MeUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<MeUser | null> => {
    try {
      const me = await api<MeUser>('/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<void>('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}

export const SCREEN_PATHS: Record<string, string> = {
  home: '/',
  dashboard: '/dashboard',
  base: '/base',
  kanban: '/kanban',
  reports: '/relatorios',
  settings: '/configuracoes',
};

export const PATH_SCREENS: Record<string, string> = {
  '/': 'home',
  '/dashboard': 'dashboard',
  '/base': 'base',
  '/kanban': 'kanban',
  '/relatorios': 'reports',
  '/configuracoes': 'settings',
};

export const SCREEN_LABELS: Record<string, string> = {
  home: 'Início',
  dashboard: 'Dashboard',
  base: 'Base',
  kanban: 'Quadro',
  reports: 'Relatórios',
  settings: 'Configurações',
};

export const SCREEN_ORDER = [
  'home',
  'dashboard',
  'base',
  'kanban',
  'reports',
  'settings',
];

export function isDashboardOnly(user: MeUser): boolean {
  return user.profile.screens.length === 1 && user.profile.screens[0] === 'dashboard';
}

export function can(user: MeUser | null, permission: string): boolean {
  if (!user) return false;
  return user.profile.permissions.includes(permission);
}

export function canAny(user: MeUser | null, permissions: string[]): boolean {
  if (!user) return false;
  return permissions.some((permission) => user.profile.permissions.includes(permission));
}

export function homePathFor(user: MeUser): string {
  const activeProjects = user.projects.filter((project) => project.is_active);
  if (isDashboardOnly(user)) {
    if (activeProjects.length === 1) {
      return `/dashboard?proj=${activeProjects[0].id}`;
    }
    if (activeProjects.length > 1) {
      return '/escolher-projeto';
    }
    return '/dashboard';
  }
  if (user.profile.screens.includes('home')) return '/';
  const first = user.profile.screens[0];
  return first ? SCREEN_PATHS[first] ?? '/' : '/';
}
