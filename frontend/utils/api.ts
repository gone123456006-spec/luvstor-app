import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';
import { getOrCreateDeviceId } from './device';

const API_PORT = 5000;

function hostFromUri(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const host = uri.replace(/^[a-z]+:\/\//i, '').split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  // Expo tunnel host — backend is not on ngrok; use LAN IP instead
  if (host.includes('.exp.direct') || host.includes('ngrok')) return null;
  return host;
}

function getDevLanIp(): string | null {
  const fromEnv = process.env.EXPO_PUBLIC_DEV_LAN_IP?.trim();
  if (fromEnv && fromEnv !== 'localhost' && fromEnv !== '127.0.0.1') {
    return fromEnv;
  }
  return null;
}

/** IP/host Metro uses to serve the app (same machine as backend). */
function getExpoDevHost(): string | null {
  const fromConfig = hostFromUri(Constants.expoConfig?.hostUri);
  if (fromConfig) return fromConfig;

  const manifest2 = (Constants as {
    manifest2?: { extra?: { expoClient?: { hostUri?: string; debuggerHost?: string } } };
  }).manifest2?.extra?.expoClient;
  const fromManifest2 =
    hostFromUri(manifest2?.hostUri) ?? hostFromUri(manifest2?.debuggerHost);
  if (fromManifest2) return fromManifest2;

  const legacyManifest = (Constants as { manifest?: { debuggerHost?: string } }).manifest;
  const fromLegacy = hostFromUri(legacyManifest?.debuggerHost);
  if (fromLegacy) return fromLegacy;

  // Bundle URL is the most reliable source on physical Android/iOS devices.
  const scriptURL = NativeModules.SourceCode?.scriptURL as string | undefined;
  const fromScript = hostFromUri(scriptURL);
  if (fromScript) return fromScript;

  return null;
}

function resolveApiBase(): string {
  // 1. Expo Metro / bundler host (same LAN as backend)
  const expoHost = getExpoDevHost();
  if (expoHost) {
    return `http://${expoHost}:${API_PORT}`;
  }

  // 2. Tunnel mode — Metro is ngrok but API stays on PC LAN IP
  const lanIp = getDevLanIp();
  if (lanIp) {
    return `http://${lanIp}:${API_PORT}`;
  }

  // 3. Explicit override in .env
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  }

  if (Platform.OS === 'web') {
    return `http://localhost:${API_PORT}`;
  }

  if (Platform.OS === 'android' && !Constants.isDevice) {
    // Android emulator — host machine is always 10.0.2.2
    return `http://10.0.2.2:${API_PORT}`;
  }

  // 4. Last resort — auto-resolve from Expo dev server URL
  return `http://localhost:${API_PORT}`;
}

/** Resolved at call time so physical devices use Metro's LAN IP, not localhost. */
export function getApiBase(): string {
  return resolveApiBase();
}

/** Snapshot at import — use getApiBase() when building URLs after app load. */
export const API_BASE = getApiBase();

export const AUTH_TOKEN_KEY = 'auth_token';
export const AUTH_USER_KEY = 'auth_user';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type SessionInvalidHandler = (code?: string) => void;
let onSessionInvalid: SessionInvalidHandler | null = null;

/** Register a handler for DEVICE_MISMATCH / revoked sessions */
export function setOnSessionInvalid(handler: SessionInvalidHandler | null) {
  onSessionInvalid = handler;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${getApiBase()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(
      `Cannot reach server at ${getApiBase()}. Run "npm run dev" in backend, use "npm start" in frontend, and ensure phone + PC share the same Wi‑Fi.`
    );
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }

  if (!res.ok) {
    const code = typeof data.code === 'string' ? data.code : undefined;
    const message = (data.error as string) || `Request failed (${res.status})`;

    if (code === 'DEVICE_MISMATCH' || (res.status === 401 && code === 'DEVICE_MISMATCH')) {
      onSessionInvalid?.(code);
    }

    throw new ApiError(message, res.status, code);
  }
  return data;
}

export async function apiGoogleLogin(
  idToken: string,
  options?: { forceTransfer?: boolean }
): Promise<{ success: boolean; token: string; user: any }> {
  const deviceId = await getOrCreateDeviceId();
  return apiFetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      deviceId,
      forceTransfer: Boolean(options?.forceTransfer),
    }),
  }) as Promise<{ success: boolean; token: string; user: any }>;
}

export async function apiSendOTP(email: string): Promise<{
  success: boolean;
  message: string;
  resendCooldownSeconds?: number;
  devMode?: boolean;
}> {
  return apiFetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }) as Promise<{
    success: boolean;
    message: string;
    resendCooldownSeconds?: number;
    devMode?: boolean;
  }>;
}

export async function apiVerifyOTP(
  email: string,
  otp: string,
  options?: { forceTransfer?: boolean }
): Promise<{ success: boolean; token: string; user: any }> {
  const deviceId = await getOrCreateDeviceId();
  return apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      otp,
      deviceId,
      forceTransfer: Boolean(options?.forceTransfer),
    }),
  }) as Promise<{ success: boolean; token: string; user: any }>;
}

/** OTP-verified move of the session onto this device */
export async function apiTransferDevice(
  email: string,
  otp: string
): Promise<{ success: boolean; token: string; user: any }> {
  const deviceId = await getOrCreateDeviceId();
  return apiFetch('/api/auth/transfer-device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp, deviceId }),
  }) as Promise<{ success: boolean; token: string; user: any }>;
}

export async function apiLogout(token: string): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Still clear local session even if network fails
  }
}

export async function saveAuthSession(token: string, user: object): Promise<void> {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.multiSet([
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_KEY, JSON.stringify(user)],
  ]);
}

export async function apiRequest(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<any> {
  return apiFetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}
