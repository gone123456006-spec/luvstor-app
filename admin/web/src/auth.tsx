import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAuthErrorHandler } from './api';

export type Admin = {
  id: string;
  email: string;
  name: string;
  role: string;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  mfaPolicyRequired: boolean;
  mfaRecoveryCodesLeft: number;
  permissions: string[];
  mediaBaseUrl: string;
};

/** Password accepted; the caller must finish with `verifyMfa` */
export type LoginResult = { mfaToken: string } | null;

type AuthState = {
  admin: Admin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
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
      } else if (err.code === 'MFA_SETUP_REQUIRED') {
        setAdmin((a) => (a ? { ...a, mfaSetupRequired: true } : a));
      } else {
        setAdmin(null);
      }
    });
    return () => setAuthErrorHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const r = await api<{ admin?: Admin; mfaRequired?: boolean; mfaToken?: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (r.mfaRequired && r.mfaToken) return { mfaToken: r.mfaToken };
    if (r.admin) setAdmin(r.admin);
    return null;
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const r = await api<{ admin: Admin }>('/auth/mfa/login', { method: 'POST', body: { mfaToken, code } });
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
    () => ({ admin, loading, login, verifyMfa, logout, setAdmin, can }),
    [admin, loading, login, verifyMfa, logout, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
