import { ApiError, fetchWithTimeout, getApiBase } from './api';

import { SubscriptionStatus } from './subscriptions';

export type PlanEntitlements = Pick<
  SubscriptionStatus,
  | 'plan'
  | 'planName'
  | 'badge'
  | 'isActive'
  | 'chatSessionHours'
  | 'unlimitedChat'
  | 'tokenBonusPercent'
  | 'spinsPerDay'
  | 'spinsRemaining'
  | 'discoverBoost'
  | 'topSpotDaily'
>;

export type ChatAccessStatus = {
  ok?: boolean;
  renewed?: boolean;
  tokenBalance: number;
  hasActiveSession: boolean;
  sessionStartedAt: string | null;
  sessionExpiresAt: string | null;
  remainingMs: number;
  canChat: boolean;
  tokenCost: number;
  sessionDurationMs: number;
  unlimitedChat?: boolean;
  subscription?: PlanEntitlements;
  serverNow: string;
  code?: string;
  message?: string;
  error?: string;
};

async function tokenFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<ChatAccessStatus> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${getApiBase()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("Couldn't connect. Check your internet and try again.");
  }
  let data: ChatAccessStatus = {} as ChatAccessStatus;
  try {
    data = (await res.json()) as ChatAccessStatus;
  } catch {
    /* empty */
  }

  // 402 returns structured insufficient-tokens payload (not an exception path)
  if (res.status === 402) {
    return {
      ok: false,
      code: data.code || 'INSUFFICIENT_TOKENS',
      message:
        data.message ||
        data.error ||
        "You don't have enough tokens to continue chatting. Please purchase more tokens to continue.",
      tokenBalance: data.tokenBalance ?? 0,
      hasActiveSession: false,
      sessionStartedAt: null,
      sessionExpiresAt: null,
      remainingMs: 0,
      canChat: false,
      tokenCost: data.tokenCost ?? 10,
      sessionDurationMs: data.sessionDurationMs ?? 2 * 60 * 60 * 1000,
      serverNow: data.serverNow || new Date().toISOString(),
    };
  }

  if (!res.ok) {
    throw new ApiError(
      data.error || data.message || `Request failed (${res.status})`,
      res.status,
      data.code,
    );
  }

  return data;
}

export async function fetchChatAccess(
  token: string,
  otherUserId?: string | null,
): Promise<ChatAccessStatus> {
  const q =
    otherUserId && String(otherUserId)
      ? `?otherUserId=${encodeURIComponent(String(otherUserId))}`
      : '';
  return tokenFetch(`/api/tokens/chat-access${q}`, token);
}

/** Deduct 10 tokens when starting/renewing a 2h session (per conversation for free users). */
export async function ensureChatSession(
  token: string,
  otherUserId?: string | null,
): Promise<ChatAccessStatus> {
  return tokenFetch('/api/tokens/ensure-session', token, {
    method: 'POST',
    body: JSON.stringify(
      otherUserId ? { otherUserId: String(otherUserId) } : {},
    ),
  });
}

export async function fetchTokenBalance(token: string): Promise<{
  tokenBalance: number;
  lastSpinDate: string | null;
  canSpinToday: boolean;
  spinsRemaining: number;
  spinsPerDay: number;
  nextSpinAt?: string | null;
  spinCooldownMs?: number;
  spinCycleDay?: number;
  spinCycleTokens?: number;
  spinCycle?: number[];
  spinCycleLength?: number;
  openStreakDays?: number;
  spinStreakDays?: number;
  hasActiveSession: boolean;
  remainingMs: number;
  sessionExpiresAt: string | null;
  sessionDurationMs?: number;
  serverNow: string;
  subscription?: PlanEntitlements;
}> {
  return tokenFetch('/api/tokens/balance', token) as Promise<{
    tokenBalance: number;
    lastSpinDate: string | null;
    canSpinToday: boolean;
    spinsRemaining: number;
    spinsPerDay: number;
    nextSpinAt?: string | null;
    spinCooldownMs?: number;
    spinCycleDay?: number;
    spinCycleTokens?: number;
    spinCycle?: number[];
    spinCycleLength?: number;
    hasActiveSession: boolean;
    remainingMs: number;
    sessionExpiresAt: string | null;
    sessionDurationMs?: number;
    serverNow: string;
    subscription?: PlanEntitlements;
  }>;
}

/** Claim lucky spin — server chooses reward and updates tokenBalance. */
export async function claimDailySpin(authToken: string): Promise<{
  success: boolean;
  winIndex: number;
  reward: { label: string; tokens: number; spinCycleDay?: number };
  tokenBalance: number;
  canSpinToday: boolean;
  spinsRemaining?: number;
  spinsPerDay?: number;
  nextSpinAt?: string | null;
  code?: string;
  error?: string;
}> {
  try {
    const res = await fetchWithTimeout(`${getApiBase()}/api/tokens/spin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        winIndex: -1,
        reward: { label: '', tokens: 0 },
        tokenBalance: data.tokenBalance ?? 0,
        canSpinToday: false,
        spinsRemaining: data.spinsRemaining ?? 0,
        nextSpinAt: data.nextSpinAt ?? null,
        code: data.code,
        error: data.error || 'Spin failed',
      };
    }
    return data;
  } catch {
    return {
      success: false,
      winIndex: -1,
      reward: { label: '', tokens: 0 },
      tokenBalance: 0,
      canSpinToday: true,
      error: 'Could not reach server. Try again.',
    };
  }
}

/** @deprecated Direct purchase is disabled server-side (PAYMENT_REQUIRED). Use Razorpay flow. */
export async function purchaseTokenPack(
  authToken: string,
  packageName: string,
): Promise<{ success: boolean; tokenBalance: number; credited?: number; error?: string }> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/tokens/purchase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ packageName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      success: false,
      tokenBalance: data.tokenBalance ?? 0,
      error: data.error || 'Purchase failed',
    };
  }
  return {
    success: true,
    tokenBalance: data.tokenBalance ?? 0,
    credited: data.credited,
  };
}

export function formatSessionRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
