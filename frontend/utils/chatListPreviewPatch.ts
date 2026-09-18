import {
  ChatListSnapshot,
  ConversationItem,
  getChatListCache,
  setChatListCache,
} from './chatListCache';
import { resolveMediaUrl } from './media';

export type ChatPreviewPatch = {
  otherUserId: string;
  /** Omit to leave the existing preview text unchanged (e.g. resetUnread only) */
  lastMessage?: string;
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

/**
 * Returns the original array when the row is absent, so React can bail out of
 * re-rendering lists that did not actually change.
 */
function patchRows(
  rows: ConversationItem[],
  otherId: string,
  update: Partial<ConversationItem>,
): ConversationItem[] {
  if (!rows.some((r) => r.otherId === otherId)) return rows;
  return rows.map((r) => (r.otherId === otherId ? { ...r, ...update } : r));
}

/**
 * WhatsApp keep-archived:
 * - New messages stay in Archive (do not jump to All)
 * - Archive row gets preview + unread badge
 * - Main lists only update when the chat is not archived
 */
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
  const touchPreview = patch.lastMessage !== undefined;
  const lastMessage = touchPreview
    ? previewLabel({ ...patch, lastMessage: patch.lastMessage || '' })
    : undefined;

  const archivedExisting = (snapshot.archiveRows || []).find(
    (r) => r.otherId === otherId,
  );

  const existing =
    snapshot.conversations.find((r) => r.otherId === otherId) ||
    snapshot.friendRows.find((r) => r.otherId === otherId) ||
    snapshot.requestRows.find((r) => r.otherId === otherId) ||
    archivedExisting;

  const unreadFor = (prev: number) => {
    if (patch.resetUnread) return 0;
    if (patch.incrementUnread) return prev + 1;
    return prev;
  };

  // Socket payloads carry relative /uploads paths — resolve before caching
  const patchPhoto = patch.photo ? resolveMediaUrl(patch.photo) || '' : '';

  const rowUpdate: Partial<ConversationItem> = {
    unread: unreadFor(existing?.unread ?? 0),
    ...(touchPreview && lastMessage != null
      ? { lastMessage, lastMessageAt: at }
      : null),
    ...(patch.name ? { name: patch.name } : null),
    ...(patchPhoto ? { photo: patchPhoto } : null),
    ...(patch.gender ? { gender: patch.gender } : null),
  };

  // Keep archived — WhatsApp "Keep chats archived"
  if (archivedExisting) {
    return {
      conversations: snapshot.conversations,
      friendRows: snapshot.friendRows,
      requestRows: snapshot.requestRows,
      onlineRows: patchRows(snapshot.onlineRows, otherId, {
        ...(touchPreview
          ? {
              lastMessage: patch.fromMe
                ? 'You sent a message'
                : lastMessage || archivedExisting.lastMessage,
              lastMessageAt: at,
            }
          : null),
        unread: unreadFor(
          snapshot.onlineRows.find((r) => r.otherId === otherId)?.unread ??
            archivedExisting.unread ??
            0,
        ),
      }),
      archiveRows: bumpRow(snapshot.archiveRows || [], otherId, rowUpdate),
    };
  }

  const baseRow: ConversationItem = existing
    ? { ...existing, ...rowUpdate }
    : {
        otherId,
        name: patch.name || 'User',
        photo: patchPhoto,
        gender: patch.gender || '',
        isOnline: false,
        lastMessage: lastMessage || 'Message',
        lastMessageAt: at,
        unread: patch.incrementUnread ? 1 : 0,
        category: 'stranger',
      };

  let conversations = bumpRow(snapshot.conversations, otherId, rowUpdate);
  if (!conversations.some((r) => r.otherId === otherId)) {
    conversations = [baseRow, ...conversations];
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
      ...(touchPreview
        ? {
            lastMessage: patch.fromMe
              ? 'You sent a message'
              : lastMessage ||
                existing?.lastMessage ||
                'Message',
            lastMessageAt: at,
          }
        : null),
      unread: unreadFor(
        snapshot.onlineRows.find((r) => r.otherId === otherId)?.unread ??
          existing?.unread ??
          0,
      ),
    }),
    archiveRows: snapshot.archiveRows || [],
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

/** True if this chat is currently in the Archive list cache */
export function isArchivedInChatCache(
  sessionVersion: number,
  otherUserId: string,
): boolean {
  const id = String(otherUserId || '');
  if (!id) return false;
  const snap = getChatListCache(sessionVersion);
  return (snap.archiveRows || []).some((r) => r.otherId === id);
}
