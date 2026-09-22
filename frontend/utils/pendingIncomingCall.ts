/**
 * Holds an incoming-call payload from FCM / local notification
 * until CallProvider can sync and show UI (or accept/decline from tray).
 * Persists to AsyncStorage so Answer/Decline survive cold start.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PendingCallAction = 'open' | 'accept' | 'decline';

export type PendingIncomingCall = {
  callId: string;
  callerId: string;
  callType: 'voice' | 'video';
  callerName?: string;
  callerPhoto?: string;
  /** What the user tapped on the notification */
  intent: PendingCallAction;
  receivedAt: number;
};

const STORAGE_KEY = '@luvstor/pending_incoming_call';
const TTL_MS = 90_000;

let pending: PendingIncomingCall | null = null;
let hydrated = false;
const listeners = new Set<(p: PendingIncomingCall | null) => void>();

function notify() {
  listeners.forEach((fn) => fn(pending));
}

function isFresh(p: PendingIncomingCall | null): p is PendingIncomingCall {
  return !!p && Date.now() - p.receivedAt <= TTL_MS;
}

async function persist(next: PendingIncomingCall | null) {
  try {
    if (!next) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Load any pending Answer/Decline from disk (cold start). */
export async function hydratePendingIncomingCall(): Promise<PendingIncomingCall | null> {
  if (hydrated) return getPendingIncomingCall();
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingIncomingCall;
    if (!isFresh(parsed) || !parsed.callId) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    pending = parsed;
    notify();
    return pending;
  } catch {
    return null;
  }
}

export function setPendingIncomingCall(
  data: Record<string, any> | null | undefined,
  intent: PendingCallAction = 'open',
): void {
  if (!data?.callId) {
    pending = null;
    notify();
    void persist(null);
    return;
  }
  const action = String(data.action || '').toLowerCase();
  const missed = data.missed === true || data.missed === 'true';
  if (
    missed ||
    (action && action !== 'incoming' && action !== 'accept' && action !== 'decline')
  ) {
    // Still allow accept/decline intents from notification buttons
    if (intent === 'open') return;
  }
  pending = {
    callId: String(data.callId),
    callerId: String(data.userId || data.actorId || data.from || ''),
    callType: data.callType === 'video' ? 'video' : 'voice',
    callerName: data.callerName || data.actorName || data.title || undefined,
    callerPhoto: String(data.actorPhoto || data.callerPhoto || '') || undefined,
    intent,
    receivedAt: Date.now(),
  };
  notify();
  void persist(pending);
}

export function getPendingIncomingCall(): PendingIncomingCall | null {
  if (pending && !isFresh(pending)) {
    pending = null;
    void persist(null);
  }
  return pending;
}

export function clearPendingIncomingCall(callId?: string | null): void {
  if (callId && pending && pending.callId !== String(callId)) return;
  pending = null;
  notify();
  void persist(null);
}

export function subscribePendingIncomingCall(
  fn: (p: PendingIncomingCall | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
