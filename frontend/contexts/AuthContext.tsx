import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AuthUser } from '../utils/auth';
import { completeAccountLogin, getCurrentAuthUser, logout } from '../utils/auth';

type AuthContextValue = {
  sessionVersion: number;
  user: AuthUser | null;
  refreshSession: () => Promise<void>;
  loginWithToken: (token: string, user: AuthUser) => Promise<AuthUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionVersion, setSessionVersion] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);

  const bump = useCallback(() => {
    setSessionVersion((v) => v + 1);
  }, []);

  const refreshSession = useCallback(async () => {
    const current = await getCurrentAuthUser();
    setUser(current);
    bump();
  }, [bump]);

  React.useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const loginWithToken = useCallback(
    async (token: string, authUser: AuthUser) => {
      const hydrated = await completeAccountLogin(token, authUser);
      setUser(hydrated);
      bump();
      return hydrated;
    },
    [bump]
  );

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
    bump();
  }, [bump]);

  const value = useMemo(
    () => ({
      sessionVersion,
      user,
      refreshSession,
      loginWithToken,
      signOut,
    }),
    [sessionVersion, user, refreshSession, loginWithToken, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
