import { useEffect, useState } from 'react';

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

/** Refresh list once per minute so "Just now" becomes clock time */
export function useTimeTick(intervalMs = 60000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
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
