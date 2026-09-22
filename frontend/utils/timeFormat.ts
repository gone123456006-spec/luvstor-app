import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

const clockOptions: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

/** Time inside a message bubble — always real clock time, no seconds */
export function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], clockOptions);
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${date.toLocaleTimeString([], clockOptions)}`;
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], clockOptions)}`;
}

/**
 * Chat list time — "Just now" for < 1 min, then real clock time (e.g. 2:30 PM).
 * No "1m ago" / "2m ago".
 */
export function formatChatListTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);

  if (diff < 60 * 1000) {
    return 'Just now';
  }

  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], clockOptions);
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const daysAgo = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (daysAgo < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Refresh list once per minute so "Just now" becomes clock time.
 * Pauses while the app is backgrounded — a ticking clock behind a closed app
 * only burns re-renders.
 */
export function useTimeTick(intervalMs = 60000, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!id) id = setInterval(() => setTick((t) => t + 1), intervalMs);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) =>
      state === 'active' ? start() : stop(),
    );
    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs, enabled]);
  return tick;
}

export function parseLegacyChatTime(timeStr?: string): number {
  if (!timeStr) return Date.now();
  const lower = timeStr.toLowerCase().trim();
  if (lower === 'just now') return Date.now();
  const minMatch = lower.match(/^(\d+)\s*m(?:in)?\s*ago$/);
  if (minMatch) return Date.now() - parseInt(minMatch[1], 10) * 60000;
  const hourMatch = lower.match(/^(\d+)\s*h(?:our)?\s*ago$/);
  if (hourMatch) return Date.now() - parseInt(hourMatch[1], 10) * 3600000;
  return Date.now();
}

/**
 * WhatsApp-style last-seen subtitle for chat headers.
 * e.g. "last seen today at 3:45 PM", "last seen yesterday at 9:02 AM"
 */
export function formatLastSeen(timestamp?: string | number | Date | null): string {
  if (timestamp == null || timestamp === '') return 'Offline';
  const date = new Date(timestamp);
  const t = date.getTime();
  if (!Number.isFinite(t)) return 'Offline';

  const now = new Date();
  const time = date.toLocaleTimeString([], clockOptions);

  if (date.toDateString() === now.toDateString()) {
    return `last seen today at ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `last seen yesterday at ${time}`;
  }

  const daysAgo = Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
  if (daysAgo < 7) {
    const weekday = date.toLocaleDateString([], { weekday: 'long' });
    return `last seen ${weekday} at ${time}`;
  }

  const day = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return `last seen ${day} at ${time}`;
}

