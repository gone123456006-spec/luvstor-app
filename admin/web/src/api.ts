export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Listener = (err: ApiError) => void;
let onAuthError: Listener | null = null;
export function setAuthErrorHandler(fn: Listener | null) {
  onAuthError = fn;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method || 'GET';
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'luvstor-admin',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.code);
    const isSignInStep = path.startsWith('/auth/login') || path.startsWith('/auth/mfa/login');
    if (
      (res.status === 401 && !isSignInStep) ||
      err.code === 'MUST_CHANGE_PASSWORD' ||
      err.code === 'MFA_SETUP_REQUIRED'
    ) {
      onAuthError?.(err);
    }
    throw err;
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}
