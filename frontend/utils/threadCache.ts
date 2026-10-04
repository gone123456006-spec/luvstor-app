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
/** Preloaded server rows not yet mapped (mapping needs the screen's mapper). */
const rawMemory = new Map<string, unknown[]>();
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

/** Raw preloaded rows for a thread, so the chat can paint on its first frame. */
export function getRawThreadFromMemory(chatId: string): unknown[] | undefined {
  const rows = rawMemory.get(String(chatId));
  return rows?.length ? rows : undefined;
}

function rememberStored(chatId: string, raw: string | null) {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as StoredThread;
    if (parsed?.kind === 'mapped' && Array.isArray(parsed.messages)) {
      if (!memory.has(chatId)) memory.set(chatId, parsed.messages);
    } else if (parsed?.kind === 'raw' && Array.isArray(parsed.raw)) {
      rawMemory.set(chatId, parsed.raw);
    }
  } catch {
    /* corrupt cache */
  }
}

/**
 * Pull saved threads from disk into memory ahead of time (chat list idle,
 * finger-down on a row) so opening them never waits on storage.
 */
export async function warmThreadsFromDisk(
  email: string | null | undefined,
  chatIds: string[],
): Promise<void> {
  const normalized = String(email || persistEmail || '').trim().toLowerCase();
  if (!normalized) return;
  const ids = [...new Set(chatIds.map(String).filter(Boolean))].filter(
    (id) => !memory.has(id) && !rawMemory.has(id),
  );
  if (!ids.length) return;
  try {
    const pairs = await AsyncStorage.multiGet(
      ids.map((id) => chatHistoryKey(normalized, id)),
    );
    pairs.forEach(([, value], i) => rememberStored(ids[i], value));
  } catch {
    /* storage unavailable — the screen loads normally */
  }
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

/** Disk copy is for instant open; older pages still load from the server. */
const PERSIST_MAX_MESSAGES = 300;
const PERSIST_DEBOUNCE_MS = 600;

export function schedulePersistThread(chatId: string, messages: CachedChatMsg[]) {
  const id = String(chatId);
  memory.set(id, messages);
  rawMemory.delete(id);
  if (!persistEmail) return;
  pendingWrites.set(id, messages);
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushThreadWrites();
  }, PERSIST_DEBOUNCE_MS);
}

async function flushThreadWrites() {
  if (!persistEmail) return;
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  await Promise.all(
    entries.map(([chatId, messages]) =>
      AsyncStorage.setItem(
        chatHistoryKey(persistEmail!, chatId),
        JSON.stringify({
          kind: 'mapped',
          messages: messages.slice(-PERSIST_MAX_MESSAGES),
          at: Date.now(),
        } satisfies StoredThread),
      ).catch(() => {}),
    ),
  );
}

/** Background preload — stores raw API rows until the thread is opened.
 *  Must NOT pass markRead — visiting Chats must not blue-tick messages.
 */
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
    if (existing) {
      rememberStored(id, existing);
      return;
    }
  } catch {
    /* continue */
  }

  try {
    // Intentionally no markRead — list preload must not mark messages seen
    const history: unknown[] = await apiRequest(`/api/chat/history/${id}`, token);
    if (!Array.isArray(history) || !history.length) return;
    if (!memory.has(id)) rawMemory.set(id, history);
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
  rawMemory.delete(id);
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
