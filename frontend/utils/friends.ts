import { API_BASE } from './api';

export interface FriendshipStatus {
  status: 'stranger' | 'pending_like' | 'mutual_match' | 'friends' | 'declined' | 'blocked' | 'self';
  areFriends: boolean;
  canSendMedia: boolean;
  canCall: boolean;
  iLiked?: boolean;
  theyLiked?: boolean;
  iBlocked?: boolean;
  theyBlocked?: boolean;
  blockedAt?: string | null;
  privacyHidden?: boolean;
  friendship?: any;
}

export interface FriendRequest {
  _id: string;
  otherId: string;
  otherUser: {
    name: string;
    photo: string;
    gender: string;
    age?: number;
    bio?: string;
    isOnline: boolean;
  };
  status: string;
  requestType?: 'incoming_like' | 'mutual_match' | 'outgoing_like';
  acceptedByMe?: boolean;
  likedAt?: string;
  matchedAt?: string;
  friendsSince?: string;
  updatedAt?: string;
  iLiked?: boolean;
}

/**
 * Send a like to another user
 */
export async function sendLike(token: string, userId: string): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/friends/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to send like');
  }
  
  return res.json();
}

/**
 * Undo a like or remove friendship
 */
export async function unlikeUser(token: string, userId: string): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/friends/unlike`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to unlike user');
  }

  return res.json();
}

/**
 * Get friendship status with a specific user
 */
export async function getFriendshipStatus(token: string, userId: string): Promise<FriendshipStatus> {
  const res = await fetch(`${API_BASE}/api/friends/status/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to get friendship status');
  }
  
  return res.json();
}

/**
 * Get list of friend requests (mutual matches)
 */
export async function getFriendRequests(token: string): Promise<FriendRequest[]> {
  const res = await fetch(`${API_BASE}/api/friends/requests`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to get friend requests');
  }
  
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Accept a friend request
 */
export async function acceptFriendRequest(token: string, userId: string): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/friends/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to accept friend request');
  }
  
  return res.json();
}

/**
 * Decline a friend request
 */
export async function declineFriendRequest(token: string, userId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/friends/decline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to decline friend request');
  }
  
  return res.json();
}

/**
 * Get list of friends
 */
export async function getFriendsList(token: string): Promise<FriendRequest[]> {
  const res = await fetch(`${API_BASE}/api/friends/list`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to get friends list');
  }
  
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Outgoing likes I sent (waiting for them to like back)
 */
export async function getOutgoingLikes(token: string): Promise<FriendRequest[]> {
  const res = await fetch(`${API_BASE}/api/friends/likes`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to get likes');
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Unfriend a user
 */
export async function unfriend(token: string, userId: string): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/friends/unfriend`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to unfriend user');
  }
  
  return res.json();
}

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'inappropriate'
  | 'fake_profile'
  | 'underage'
  | 'other';

/**
 * Block a user
 */
export async function blockUser(
  token: string,
  userId: string,
): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/friends/block`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to block user');
  }

  return res.json();
}

/**
 * Unblock a user
 */
export async function unblockUser(
  token: string,
  userId: string,
): Promise<{ message: string; status: string }> {
  const res = await fetch(`${API_BASE}/api/friends/unblock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to unblock user');
  }

  return res.json();
}

export type BlockedUser = {
  _id: string;
  otherId: string;
  blockedAt?: string;
  otherUser: {
    id: string;
    name: string;
    photo: string;
    gender: string;
    age?: number | null;
    bio?: string;
    publicId?: string;
    isOnline?: boolean;
  };
};

/**
 * List users the current account has blocked
 */
export async function getBlockedUsers(token: string): Promise<BlockedUser[]> {
  const res = await fetch(`${API_BASE}/api/friends/blocked`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load blocked users');
  }

  const data = await res.json();
  return (data?.blocked || []) as BlockedUser[];
}

/**
 * Report a user (optionally block at the same time)
 */
export async function reportUser(
  token: string,
  userId: string,
  reason: ReportReason,
  opts: { details?: string; alsoBlock?: boolean } = {},
): Promise<{ message: string; blocked: boolean }> {
  const res = await fetch(`${API_BASE}/api/friends/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId,
      reason,
      details: opts.details || '',
      alsoBlock: !!opts.alsoBlock,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to report user');
  }

  return res.json();
}
