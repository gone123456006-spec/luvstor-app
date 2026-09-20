/**
 * Holds an incoming-call payload from FCM / local notification
 * until CallProvider can sync and show UI (or accept/decline from tray).
 */

export type PendingCallAction = 'open' | 'accept' | 'decline';

export type PendingIncomingCall = {
  callId: string;
  callerId: string;
  callType: 'voice' | 'video';
  callerName?: string;
  /** What the user tapped on the notification */
  intent: PendingCallAction;
  receivedAt: number;
};

let pending: PendingIncomingCall | null = null;
const listeners = new Set<(p: PendingIncomingCall | null) => void>();

function notify() {
  listeners.forEach((fn) => fn(pending));
}

export function setPendingIncomingCall(
  data: Record<string, any> | null | undefined,
  intent: PendingCallAction = 'open',
): void {
  if (!data?.callId) {
    pending = null;
    notify();
    return;
  }
  const action = String(data.action || '').toLowerCase();
  const missed = data.missed === true || data.missed === 'true';
  if (missed || (action && action !== 'incoming' && action !== 'accept' && action !== 'decline')) {
    // Still allow accept/decline intents from notification buttons
    if (intent === 'open') return;
  }
  pending = {
    callId: String(data.callId),
    callerId: String(data.userId || data.actorId || data.from || ''),
    callType: data.callType === 'video' ? 'video' : 'voice',
    callerName: data.callerName || data.actorName || data.title || undefined,
    intent,
    receivedAt: Date.now(),
  };
  notify();
}

export function getPendingIncomingCall(): PendingIncomingCall | null {
  if (pending && Date.now() - pending.receivedAt > 60_000) {
    pending = null;
  }
  return pending;
}

export function clearPendingIncomingCall(callId?: string | null): void {
  if (callId && pending && pending.callId !== String(callId)) return;
  pending = null;
  notify();
}

export function subscribePendingIncomingCall(
  fn: (p: PendingIncomingCall | null) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
