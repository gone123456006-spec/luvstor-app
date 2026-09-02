import { API_BASE } from './api';

export async function archiveConversation(
  token: string,
  otherUserId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/archive/${otherUserId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to archive chat');
  }
}

export async function unarchiveConversation(
  token: string,
  otherUserId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/unarchive/${otherUserId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to unarchive chat');
  }
}

export async function deleteConversationPermanently(
  token: string,
  otherUserId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/conversation/${otherUserId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete chat');
  }
}

export async function fetchArchivedConversations(token: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api/chat/archived`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load archived chats');
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
