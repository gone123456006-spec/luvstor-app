import { Platform } from 'react-native';
import Constants from 'expo-constants';

const API_PORT = 5000;

/** IP/host Metro uses to serve the app (same machine as backend). */
function getExpoDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } })
      .manifest2?.extra?.expoClient?.hostUri ??
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;

  if (!hostUri) return null;
  const host = hostUri.split(':')[0];
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return host;
}

function resolveApiBase(): string {
  // 1. Always try Expo's auto-detected bundler host first — works on any network
  //    without needing to hardcode or update an IP address.
  const expoHost = getExpoDevHost();
  if (expoHost) {
    return `http://${expoHost}:${API_PORT}`;
  }

  // 2. Explicit override in .env (useful for production or static setups)
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

  // 3. Last resort — auto-resolve from Expo dev server URL
  return `http://localhost:${API_PORT}`;
}

export const API_BASE = resolveApiBase();

export const AUTH_TOKEN_KEY = 'auth_token';
export const AUTH_USER_KEY = 'auth_user';

async function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(
      `Cannot reach server at ${API_BASE}. Run "npm start" in backend, use "npx expo start --lan", and ensure phone + PC share the same Wi‑Fi.`
    );
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* empty */
  }

  if (!res.ok) {
    throw new Error((data.error as string) || `Request failed (${res.status})`);
  }
  return data;
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
  otp: string
): Promise<{ success: boolean; token: string; user: any }> {
  return apiFetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  }) as Promise<{ success: boolean; token: string; user: any }>;
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
