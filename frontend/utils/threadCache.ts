import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatHistoryKey } from './accountStorage';
import { apiRequest } from './api';

/** Serializable chat row — matches messages/[id].tsx ChatMsg */
export type CachedChatMsg = {
  _id: string;
  sender: 'me' | 'other';
  text: string;
  type: 'text' | 'image' | 'audio';
  mediaUrl?: string | null;
  mediaThumb?: string | null;
  localImageUri?: string;
  localVoiceUri?: string;
  replyTo?: CachedChatMsg;
  isDeleted?: boolean;
  createdAt: number;
  pending?: boolean;
  undelivered?: boolean;
  delivered?: boolean;
  read?: boolean;
  viewOnce?: boolean;
  viewOnceOpened?: boolean;
};

type StoredThread =
  | { kind: 'mapped'; messages: CachedChatMsg[]; at: number }
  | { kind: 'raw'; raw: unknown[]; at: number };

const memory = new Map<string, CachedChatMsg[]>();
let persistEmail: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Map<string, CachedChatMsg[]>();

export function setThreadCacheAccount(email: string | null | undefined) {
  persistEmail = String(email || '').trim().toLowerCase() || null;
}

export function getThreadFromMemory(chatId: string): CachedChatMsg[] | undefined {
  const rows = memory.get(String(chatId));
  return rows?.length ? rows : undefined;
}

export function setThreadInMemory(chatId: string, messages: CachedChatMsg[]) {
  memory.set(String(chatId), messages);
}

export async function hydrateThreadFromDisk(
  chatId: string,
  mapRaw?: (raw: unknown[], myUid: string) => CachedChatMsg[],
  myUid?: string,
): Promise<CachedChatMsg[] | null> {
  const id = String(chatId);
  const cached = memory.get(id);
  if (cached?.length) return cached;

  if (!persistEmail) return null;

  try {
    const raw = await AsyncStorage.getItem(chatHistoryKey(persistEmail, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredThread;
    if (parsed?.kind === 'mapped' && Array.isArray(parsed.messages)) {
      memory.set(id, parsed.messages);
      return parsed.messages;
    }
    if (
      parsed?.kind === 'raw' &&
      Array.isArray(parsed.raw) &&
      mapRaw &&
      myUid
    ) {
      const mapped = mapRaw(parsed.raw, myUid);
      memory.set(id, mapped);
      return mapped;
    }
  } catch {
    /* corrupt cache */
  }
  return null;
}

export function schedulePersistThread(chatId: string, messages: CachedChatMsg[]) {
  const id = String(chatId);
  memory.set(id, messages);
  if (!persistEmail) return;
  pendingWrites.set(id, messages);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushThreadWrites();
  }, 350);
}

async function flushThreadWrites() {
  if (!persistEmail) return;
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  await Promise.all(
    entries.map(([chatId, messages]) =>
      AsyncStorage.setItem(
        chatHistoryKey(persistEmail!, chatId),
        JSON.stringify({ kind: 'mapped', messages, at: Date.now() } satisfies StoredThread),
      ).catch(() => {}),
    ),
  );
}

/** Background preload — stores raw API rows until the thread is opened. */
export async function preloadThreadRaw(
  email: string,
  chatId: string,
  token: string,
): Promise<void> {
  const normalized = String(email || '').trim().toLowerCase();
  const id = String(chatId);
  if (!normalized || !id) return;

  if (memory.has(id)) return;

  try {
    const existing = await AsyncStorage.getItem(chatHistoryKey(normalized, id));
    if (existing) return;
  } catch {
    /* continue */
  }

  try {
    const history: unknown[] = await apiRequest(`/api/chat/history/${id}`, token);
    if (!Array.isArray(history) || !history.length) return;
    await AsyncStorage.setItem(
      chatHistoryKey(normalized, id),
      JSON.stringify({ kind: 'raw', raw: history, at: Date.now() } satisfies StoredThread),
    );
  } catch {
    /* offline / error */
  }
}

export async function preloadRecentThreads(
  email: string,
  otherIds: string[],
  token: string,
  limit = 8,
): Promise<void> {
  const unique = [...new Set(otherIds.map(String).filter(Boolean))].slice(0, limit);
  await Promise.allSettled(
    unique.map((id) => preloadThreadRaw(email, id, token)),
  );
}

export async function clearThreadCache(
  email: string | null | undefined,
  chatId: string,
): Promise<void> {
  const id = String(chatId);
  memory.delete(id);
  pendingWrites.delete(id);

  const normalized = String(email || persistEmail || '').trim().toLowerCase();
  if (!normalized) return;

  try {
    const { chatHistoryKey } = await import('./accountStorage');
    await AsyncStorage.removeItem(chatHistoryKey(normalized, id));
  } catch {
    /* ignore */
  }
}
