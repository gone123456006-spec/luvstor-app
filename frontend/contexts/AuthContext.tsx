/**
 * AuthContext manages persistent user sessions across app restarts.
 *
 * **Persistent Login Behavior:**
 * - User session is stored in AsyncStorage (auth_token + auth_user)
 * - On app start: AuthContext loads stored session automatically
 * - Session persists across: app close/reopen, device restart, page refresh
 * - User only logs out when: explicitly tapping Logout button
 * - Session is cleared only on: manual logout, device mismatch, or server revocation
 *
 * **Device-Locked Sessions:**
 * - Each JWT contains a deviceId tied to the installation
 * - Only the bound device can use the session
 * - Another device login forces transfer via OTP
 * - Logout on original device clears the lock
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import type { AuthUser } from '../utils/auth';
import {
  ACTIVE_ACCOUNT_EMAIL_KEY,
  completeAccountLogin,
  getCurrentAuthUser,
  logout,
} from '../utils/auth';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, setOnSessionInvalid } from '../utils/api';
import { clearLegacyGlobalStorage } from '../utils/accountStorage';

type AuthContextValue = {
  sessionVersion: number;
  user: AuthUser | null;
  refreshSession: () => Promise<void>;
  loginWithToken: (token: string, user: AuthUser) => Promise<AuthUser>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function clearLocalSessionOnly() {
  await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY, ACTIVE_ACCOUNT_EMAIL_KEY]);
  await clearLegacyGlobalStorage();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionVersion, setSessionVersion] = useState(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const bump = useCallback(() => {
    setSessionVersion((v) => v + 1);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const current = await getCurrentAuthUser();
      setUser(current);
    } catch (err) {
      console.warn('[Auth] Error loading session:', err);
      setUser(null);
    } finally {
      bump();
      setIsInitialized(true);
    }
  }, [bump]);

  React.useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  React.useEffect(() => {
    if (isInitialized) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isInitialized]);

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

  // When another device took over or server revoked this device, clear local session
  React.useEffect(() => {
    setOnSessionInvalid(() => {
      void (async () => {
        await clearLocalSessionOnly();
        setUser(null);
        bump();
      })();
    });
    return () => setOnSessionInvalid(null);
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

  if (!isInitialized) {
    return null;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
