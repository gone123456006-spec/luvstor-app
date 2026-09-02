import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import { googleOAuthConfig } from '../config/googleAuth';

type GoogleSigninModule = typeof import('@react-native-google-signin/google-signin');

let configured = false;
let googleModule: GoogleSigninModule | null = null;
let googleModuleLoadFailed = false;

/** True when running inside Expo Go (native Google Sign-In is unavailable). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/** Native RNGoogleSignin module is linked in this binary. */
export function isNativeGoogleSignInAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  if (isExpoGo()) return false;
  return Boolean(NativeModules.RNGoogleSignin);
}

function loadGoogleSignInModule(): GoogleSigninModule | null {
  if (googleModule) return googleModule;
  if (googleModuleLoadFailed) return null;
  if (!isNativeGoogleSignInAvailable()) {
    googleModuleLoadFailed = true;
    return null;
  }

  try {
    // Lazy require — static import crashes Expo Go (no RNGoogleSignin native module).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    googleModule = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
    return googleModule;
  } catch {
    googleModuleLoadFailed = true;
    return null;
  }
}

function ensureGoogleSignInConfigured(mod: GoogleSigninModule) {
  if (configured || !googleOAuthConfig.webClientId) return;
  mod.GoogleSignin.configure({
    webClientId: googleOAuthConfig.webClientId,
    offlineAccess: false,
  });
  configured = true;
}

/**
 * Native Google Sign-In when available; safe no-op stub in Expo Go.
 * Email OTP login stays available either way.
 */
export function useGoogleAuth() {
  const [ready, setReady] = useState(false);
  const requiresDevBuild = !isNativeGoogleSignInAvailable();

  useEffect(() => {
    if (!isNativeGoogleSignInAvailable()) {
      setReady(false);
      return;
    }

    const mod = loadGoogleSignInModule();
    if (!mod || !googleOAuthConfig.webClientId) {
      setReady(false);
      return;
    }

    try {
      ensureGoogleSignInConfigured(mod);
      setReady(true);
    } catch {
      setReady(false);
    }
  }, []);

  const signIn = useCallback(async (): Promise<string> => {
    if (!googleOAuthConfig.webClientId) {
      throw new Error('Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in frontend/.env');
    }

    if (Platform.OS === 'web') {
      throw new Error('Google Sign-In on web is not supported yet. Use the Android app.');
    }

    if (!isNativeGoogleSignInAvailable()) {
      throw new Error(
        'Google Sign-In needs a native build (not Expo Go).\n\n' +
          'Use email OTP below, or build the app:\n' +
          'cd frontend && npm run android:build -- --device'
      );
    }

    const mod = loadGoogleSignInModule();
    if (!mod) {
      throw new Error('Google Sign-In native module failed to load. Rebuild the app.');
    }

    ensureGoogleSignInConfigured(mod);
    await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await mod.GoogleSignin.signIn();
    if (!mod.isSuccessResponse(response)) {
      throw new Error('Sign-in cancelled');
    }

    let idToken = response.data.idToken;
    if (!idToken) {
      const tokens = await mod.GoogleSignin.getTokens();
      idToken = tokens.idToken;
    }

    if (!idToken) {
      throw new Error(
        'No Google ID token. Re-download google-services.json from Firebase after enabling Google Sign-In.'
      );
    }

    return idToken;
  }, []);

  return {
    signIn,
    ready,
    requiresDevBuild,
  };
}

export function getGoogleAuthSetupHint(): string {
  if (!isNativeGoogleSignInAvailable()) {
    return 'Google Sign-In needs a native build. Email OTP works in Expo Go.';
  }
  return 'Uses native Google Sign-In (Android OAuth client + SHA-1).';
}

export function getGoogleRedirectUriHints(): string[] {
  return ['Native sign-in — no redirect URIs needed'];
}

export async function signOutGoogle(): Promise<void> {
  if (!isNativeGoogleSignInAvailable()) return;
  const mod = loadGoogleSignInModule();
  if (!mod) return;
  try {
    await mod.GoogleSignin.signOut();
  } catch {
    /* ignore */
  }
}

export function mapGoogleSignInError(err: unknown): string {
  const mod = loadGoogleSignInModule();
  if (mod?.isErrorWithCode(err)) {
    switch (err.code) {
      case mod.statusCodes.SIGN_IN_CANCELLED:
        return 'Sign-in cancelled';
      case mod.statusCodes.IN_PROGRESS:
        return 'Sign-in already in progress';
      case mod.statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        return 'Google Play Services is not available on this device';
      default:
        break;
    }
  }
  return err instanceof Error ? err.message : 'Google sign-in failed';
}
