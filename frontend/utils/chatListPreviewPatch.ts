import {
  ChatListSnapshot,
  ConversationItem,
  setChatListCache,
} from './chatListCache';

export type ChatPreviewPatch = {
  otherUserId: string;
  lastMessage: string;
  lastMessageAt?: number;
  incrementUnread?: boolean;
  resetUnread?: boolean;
  fromMe?: boolean;
  name?: string;
  photo?: string;
  gender?: string;
};

export function messagePreviewText(msg: {
  type?: string;
  text?: string;
  viewOnce?: boolean;
}): string {
  if (msg.type === 'image') return msg.viewOnce ? '📷 Photo' : '📷 Photo';
  if (msg.type === 'audio') return '🎤 Voice message';
  return (msg.text || '').trim() || 'Message';
}

function previewLabel(patch: ChatPreviewPatch): string {
  return patch.fromMe ? `You: ${patch.lastMessage}` : patch.lastMessage;
}

function bumpRow(
  rows: ConversationItem[],
  otherId: string,
  update: Partial<ConversationItem>,
): ConversationItem[] {
  const idx = rows.findIndex((r) => r.otherId === otherId);
  if (idx < 0) return rows;
  const row = { ...rows[idx], ...update };
  const rest = rows.filter((_, i) => i !== idx);
  return [row, ...rest];
}

function patchRows(
  rows: ConversationItem[],
  otherId: string,
  update: Partial<ConversationItem>,
): ConversationItem[] {
  return rows.map((r) => (r.otherId === otherId ? { ...r, ...update } : r));
}

export function applyChatListPreviewPatch(
  snapshot: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows' | 'archiveRows'
  >,
  patch: ChatPreviewPatch,
): Pick<
  ChatListSnapshot,
  'conversations' | 'friendRows' | 'requestRows' | 'onlineRows' | 'archiveRows'
> {
  const otherId = String(patch.otherUserId);
  const at = patch.lastMessageAt ?? Date.now();
  const lastMessage = previewLabel(patch);

  const existing =
    snapshot.conversations.find((r) => r.otherId === otherId) ||
    snapshot.friendRows.find((r) => r.otherId === otherId) ||
    snapshot.requestRows.find((r) => r.otherId === otherId) ||
    snapshot.archiveRows.find((r) => r.otherId === otherId);

  const unreadFor = (prev: number) => {
    if (patch.resetUnread) return 0;
    if (patch.incrementUnread) return prev + 1;
    return prev;
  };

  const rowUpdate: Partial<ConversationItem> = {
    lastMessage,
    lastMessageAt: at,
    unread: unreadFor(existing?.unread ?? 0),
  };

  let conversations = snapshot.conversations;
  if (existing) {
    conversations = bumpRow(conversations, otherId, rowUpdate);
  } else if (patch.name) {
    const row: ConversationItem = {
      otherId,
      name: patch.name,
      photo: patch.photo || '',
      gender: patch.gender || '',
      isOnline: false,
      lastMessage,
      lastMessageAt: at,
      unread: patch.incrementUnread ? 1 : 0,
      category: 'stranger',
    };
    conversations = [row, ...conversations];
  }

  const syncLists = (rows: ConversationItem[]) => {
    if (!rows.some((r) => r.otherId === otherId)) return rows;
    return bumpRow(rows, otherId, rowUpdate);
  };

  return {
    conversations,
    friendRows: syncLists(snapshot.friendRows),
    requestRows: syncLists(snapshot.requestRows),
    onlineRows: patchRows(snapshot.onlineRows, otherId, {
      lastMessage: patch.fromMe ? 'You sent a message' : lastMessage,
    }),
    archiveRows: syncLists(snapshot.archiveRows),
  };
}

export function pushChatPreviewToCache(
  sessionVersion: number,
  snapshot: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows' | 'archiveRows'
  >,
  patch: ChatPreviewPatch,
) {
  const next = applyChatListPreviewPatch(snapshot, patch);
  setChatListCache({ ...next, sessionVersion, loaded: true });
  return next;
}
