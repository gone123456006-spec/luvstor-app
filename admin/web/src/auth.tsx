import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAuthErrorHandler } from './api';

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
  permissions: string[];
  mediaBaseUrl: string;
};

type AuthState = {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setAdmin: (a: Admin | null) => void;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ admin: Admin }>('/auth/me')
      .then((r) => setAdmin(r.admin))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setAuthErrorHandler((err) => {
      if (err.code === 'MUST_CHANGE_PASSWORD') {
        setAdmin((a) => (a ? { ...a, mustChangePassword: true } : a));
      } else {
        setAdmin(null);
      }
    });
    return () => setAuthErrorHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ admin: Admin }>('/auth/login', { method: 'POST', body: { email, password } });
    setAdmin(r.admin);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setAdmin(null);
    }
  }, []);

  const can = useCallback((p: string) => !!admin?.permissions.includes(p), [admin]);

  const value = useMemo(
    () => ({ admin, loading, login, logout, setAdmin, can }),
    [admin, loading, login, logout, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
