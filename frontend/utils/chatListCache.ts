import AsyncStorage from '@react-native-async-storage/async-storage';

export type ChatCategory = 'friend' | 'request' | 'stranger';

export type ConversationItem = {
  otherId: string;
  name: string;
  photo: string;
  gender: string;
  isOnline: boolean;
  lastMessage: string;
  lastMessageAt: number;
  unread: number;
  category: ChatCategory;
  relationshipStatus?: string;
  requestType?: 'incoming_like' | 'mutual_match' | 'outgoing_like';
  areFriends?: boolean;
  iLiked?: boolean;
  theyLiked?: boolean;
  privacyHidden?: boolean;
  iBlocked?: boolean;
  theyBlocked?: boolean;
};

export type ChatFilterKey = 'All' | 'Friend' | 'Request' | 'Online' | 'Archive';

export type ChatListSnapshot = {
  conversations: ConversationItem[];
  friendRows: ConversationItem[];
  requestRows: ConversationItem[];
  onlineRows: ConversationItem[];
  archiveRows: ConversationItem[];
  activeFilter: ChatFilterKey;
  searchQuery: string;
  loaded: boolean;
  sessionVersion: number;
  at: number;
};

type ChatListSnapshotPersisted = ChatListSnapshot & {
  accountEmail?: string;
};

const empty = (sessionVersion = -1): ChatListSnapshot => ({
  conversations: [],
  friendRows: [],
  requestRows: [],
  onlineRows: [],
  archiveRows: [],
  activeFilter: 'All',
  searchQuery: '',
  loaded: false,
  sessionVersion,
  at: 0,
});

let snapshot: ChatListSnapshot = empty();
let persistEmail: string | null = null;

function storageKey(email: string) {
  return `chat_list_cache:${String(email || '').trim().toLowerCase()}`;
}

export function getChatListCache(sessionVersion: number): ChatListSnapshot {
  if (snapshot.sessionVersion !== sessionVersion) {
    if (snapshot.sessionVersion >= 0) {
      snapshot = empty(sessionVersion);
    } else {
      snapshot = { ...snapshot, sessionVersion };
    }
  }
  return snapshot;
}

export function setChatListCache(partial: Partial<ChatListSnapshot>) {
  snapshot = {
    ...snapshot,
    ...partial,
    loaded:
      partial.loaded ??
      (snapshot.loaded ||
        (partial.conversations?.length ?? 0) > 0 ||
        (partial.friendRows?.length ?? 0) > 0 ||
        (partial.requestRows?.length ?? 0) > 0 ||
        (partial.archiveRows?.length ?? 0) > 0),
    at: Date.now(),
  };

  if (persistEmail && snapshot.loaded) {
    void AsyncStorage.setItem(
      storageKey(persistEmail),
      JSON.stringify({ ...snapshot, accountEmail: persistEmail }),
    ).catch(() => {});
  }
}

export function clearChatListCache() {
  // Clear memory only — keep per-email disk cache so chats restore on next login
  snapshot = empty();
  persistEmail = null;
}

/** Load last chat list for this account from disk (instant restore). */
export async function hydrateChatListCache(
  email: string,
  sessionVersion: number,
): Promise<ChatListSnapshot> {
  persistEmail = String(email || '').trim().toLowerCase() || null;
  if (!persistEmail) {
    snapshot = empty(sessionVersion);
    return snapshot;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey(persistEmail));
    if (raw) {
      const parsed = JSON.parse(raw) as ChatListSnapshotPersisted;
      snapshot = {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        friendRows: Array.isArray(parsed.friendRows) ? parsed.friendRows : [],
        requestRows: Array.isArray(parsed.requestRows) ? parsed.requestRows : [],
        onlineRows: Array.isArray(parsed.onlineRows) ? parsed.onlineRows : [],
        archiveRows: Array.isArray(parsed.archiveRows) ? parsed.archiveRows : [],
        activeFilter: (parsed.activeFilter as ChatFilterKey) || 'All',
        searchQuery: parsed.searchQuery || '',
        loaded:
          (parsed.conversations?.length || 0) > 0 ||
          (parsed.friendRows?.length || 0) > 0 ||
          (parsed.requestRows?.length || 0) > 0 ||
          (parsed.archiveRows?.length || 0) > 0,
        sessionVersion,
        at: parsed.at || Date.now(),
      };
      return snapshot;
    }
  } catch {
    /* ignore corrupt cache */
  }

  snapshot = empty(sessionVersion);
  return snapshot;
}
