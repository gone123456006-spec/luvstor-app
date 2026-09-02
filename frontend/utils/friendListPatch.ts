import {
  ChatListSnapshot,
  ConversationItem,
  setChatListCache,
} from './chatListCache';

function cloneRows(rows: ConversationItem[]): ConversationItem[] {
  return rows.map((r) => ({ ...r }));
}

function upsertRow(
  rows: ConversationItem[],
  row: ConversationItem,
): ConversationItem[] {
  const idx = rows.findIndex((r) => r.otherId === row.otherId);
  if (idx === -1) return [row, ...rows];
  const next = [...rows];
  next[idx] = { ...next[idx], ...row };
  return next;
}

function removeRow(rows: ConversationItem[], otherId: string): ConversationItem[] {
  return rows.filter((r) => r.otherId !== otherId);
}

function patchRow(
  rows: ConversationItem[],
  otherId: string,
  patch: Partial<ConversationItem>,
): ConversationItem[] {
  return rows.map((r) =>
    r.otherId === otherId ? { ...r, ...patch } : r,
  );
}

export type FriendPatchResult = {
  conversations: ConversationItem[];
  friendRows: ConversationItem[];
  requestRows: ConversationItem[];
  onlineRows: ConversationItem[];
};

/** Instant list update after like / unlike / accept / decline — WhatsApp-style. */
export function patchListsForFriendAction(
  snapshot: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows'
  >,
  otherId: string,
  item: ConversationItem,
  action:
    | 'like_sent'
    | 'like_back'
    | 'friends'
    | 'unlike'
    | 'decline'
    | 'incoming_like',
): FriendPatchResult {
  let conversations = cloneRows(snapshot.conversations);
  let friendRows = cloneRows(snapshot.friendRows);
  let requestRows = cloneRows(snapshot.requestRows);
  let onlineRows = cloneRows(snapshot.onlineRows);

  const base: ConversationItem = {
    ...item,
    otherId,
    lastMessageAt: Date.now(),
  };

  if (action === 'incoming_like') {
    const row: ConversationItem = {
      ...base,
      category: 'request',
      requestType: 'incoming_like',
      relationshipStatus: 'pending_like',
      areFriends: false,
      iLiked: false,
      theyLiked: true,
      lastMessage: 'Liked you',
    };
    conversations = upsertRow(conversations, row);
    requestRows = upsertRow(requestRows, row);
    friendRows = removeRow(friendRows, otherId);
    onlineRows = patchRow(onlineRows, otherId, {
      category: 'request',
      theyLiked: true,
      requestType: 'incoming_like',
    });
  } else if (action === 'like_sent') {
    const row: ConversationItem = {
      ...base,
      category: base.category === 'friend' ? 'friend' : 'stranger',
      requestType: 'outgoing_like',
      relationshipStatus: 'pending_like',
      areFriends: false,
      iLiked: true,
      theyLiked: !!base.theyLiked,
      lastMessage: 'You liked them',
    };
    conversations = upsertRow(conversations, row);
    requestRows = removeRow(requestRows, otherId);
    onlineRows = patchRow(onlineRows, otherId, { iLiked: true });
  } else if (action === 'like_back' || action === 'friends') {
    const row: ConversationItem = {
      ...base,
      category: 'friend',
      requestType: undefined,
      relationshipStatus: 'friends',
      areFriends: true,
      iLiked: true,
      theyLiked: true,
      lastMessage: base.lastMessage || 'Friend',
    };
    conversations = upsertRow(conversations, row);
    friendRows = upsertRow(friendRows, row);
    requestRows = removeRow(requestRows, otherId);
    onlineRows = patchRow(onlineRows, otherId, {
      category: 'friend',
      areFriends: true,
      iLiked: true,
      theyLiked: true,
    });
  } else if (action === 'unlike') {
    const row: ConversationItem = {
      ...base,
      category: 'stranger',
      requestType: undefined,
      relationshipStatus: 'stranger',
      areFriends: false,
      iLiked: false,
      theyLiked: false,
      lastMessage: base.lastMessage || '',
    };
    conversations = patchRow(conversations, otherId, row);
    friendRows = removeRow(friendRows, otherId);
    requestRows = removeRow(requestRows, otherId);
    onlineRows = patchRow(onlineRows, otherId, {
      category: 'stranger',
      areFriends: false,
      iLiked: false,
      theyLiked: false,
    });
  } else if (action === 'decline') {
    conversations = removeRow(conversations, otherId);
    friendRows = removeRow(friendRows, otherId);
    requestRows = removeRow(requestRows, otherId);
    onlineRows = patchRow(onlineRows, otherId, {
      category: 'stranger',
      theyLiked: false,
      requestType: undefined,
    });
  }

  conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  return { conversations, friendRows, requestRows, onlineRows };
}

/** Remove a chat from main tabs only (archive keeps the row). */
export function removeConversationFromMainLists(
  snapshot: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows'
  >,
  otherId: string,
): FriendPatchResult {
  const drop = (rows: ConversationItem[]) => removeRow(rows, otherId);
  return {
    conversations: drop(snapshot.conversations),
    friendRows: drop(snapshot.friendRows),
    requestRows: drop(snapshot.requestRows),
    onlineRows: drop(snapshot.onlineRows),
  };
}

/** Remove a chat from every tab instantly (WhatsApp-style delete). */
export function removeConversationFromAllLists(
  snapshot: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows' | 'archiveRows'
  >,
  otherId: string,
): FriendPatchResult & { archiveRows: ConversationItem[] } {
  const drop = (rows: ConversationItem[]) => removeRow(rows, otherId);
  return {
    conversations: drop(snapshot.conversations),
    friendRows: drop(snapshot.friendRows),
    requestRows: drop(snapshot.requestRows),
    onlineRows: drop(snapshot.onlineRows),
    archiveRows: drop(snapshot.archiveRows || []),
  };
}

export function applyFriendListPatch(
  sessionVersion: number,
  otherId: string,
  item: ConversationItem,
  action: Parameters<typeof patchListsForFriendAction>[3],
  current: Pick<
    ChatListSnapshot,
    'conversations' | 'friendRows' | 'requestRows' | 'onlineRows'
  >,
) {
  const next = patchListsForFriendAction(current, otherId, item, action);
  setChatListCache({ ...next, sessionVersion, loaded: true });
  return next;
}
