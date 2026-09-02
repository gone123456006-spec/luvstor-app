import { apiRequest } from './api';

export type NotificationType =
  | 'chat'
  | 'match'
  | 'like'
  | 'friend_request'
  | 'friends'
  | 'call'
  | 'token'
  | 'token_purchase'
  | 'token_low'
  | 'spin'
  | 'subscription'
  | 'security'
  | 'system'
  | 'promo'
  | 'suggestion';

export type AppNotification = {
  _id: string;
  type: NotificationType;
  title: string;
  body: string;
  imageUrl?: string;
  deepLink?: string;
  groupKey?: string | null;
  priority?: 'low' | 'normal' | 'high';
  data?: Record<string, any>;
  actorId?: string | null;
  actorName?: string;
  actorPhoto?: string;
  actorGender?: string;
  read: boolean;
  createdAt: string;
};

export type NotificationPage = {
  notifications: AppNotification[];
  nextCursor: string | null;
  hasMore: boolean;
  unread: number;
};

/**
 * Cursor-paginated history. Pass `cursor` from the previous page's
 * `nextCursor` to load older items.
 */
export async function fetchNotifications(
  token: string,
  opts: {
    limit?: number;
    cursor?: string | null;
    filter?: 'all' | 'unread';
    type?: NotificationType;
  } = {},
): Promise<NotificationPage> {
  const params = new URLSearchParams();
  params.set('limit', String(opts.limit ?? 25));
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.filter === 'unread') params.set('filter', 'unread');
  if (opts.type) params.set('type', opts.type);

  const data: any = await apiRequest(`/api/notifications?${params}`, token);

  return {
    notifications: (data?.notifications || []) as AppNotification[],
    nextCursor: data?.nextCursor ?? null,
    hasMore: !!data?.hasMore,
    unread: typeof data?.unread === 'number' ? data.unread : 0,
  };
}

export async function fetchNotificationUnread(token: string) {
  const data: any = await apiRequest('/api/notifications/unread-count', token);
  return typeof data?.unread === 'number' ? data.unread : 0;
}

export async function markNotificationsRead(
  token: string,
  opts: { ids?: string[]; all?: boolean },
) {
  return apiRequest('/api/notifications/read', token, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function markNotificationsUnread(token: string, ids: string[]) {
  return apiRequest('/api/notifications/unread', token, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function deleteNotification(token: string, id: string) {
  return apiRequest(`/api/notifications/${id}`, token, { method: 'DELETE' });
}

export async function clearAllNotifications(token: string) {
  return apiRequest('/api/notifications', token, { method: 'DELETE' });
}

/** Per-category push opt-outs. Security alerts are always delivered. */
export type NotificationPreferences = {
  chat: boolean;
  social: boolean;
  calls: boolean;
  wallet: boolean;
  system: boolean;
  promotions: boolean;
  /** WhatsApp-style: show message text in the tray */
  showMessagePreview: boolean;
};

export async function fetchNotificationPreferences(token: string) {
  const data: any = await apiRequest('/api/notifications/preferences', token);
  return (data?.preferences || {}) as NotificationPreferences;
}

export async function updateNotificationPreferences(
  token: string,
  prefs: Partial<NotificationPreferences>,
) {
  const data: any = await apiRequest('/api/notifications/preferences', token, {
    method: 'PATCH',
    body: JSON.stringify(prefs),
  });
  return (data?.preferences || {}) as NotificationPreferences;
}
