/**
 * Firebase Cloud Messaging transport.
 * Credentials are shared with firebaseAdmin.js (FCM + Google login).
 */
const {
  ensureApp,
  isFirebaseAdminReady,
  getFirebaseInitError,
} = require('./firebaseAdmin');
const { absoluteMediaUrl } = require('../utils/absoluteUrl');

let messaging = null;
let enabled = false;

/** FCM error codes that mean the token will never work again. */
const PERMANENT_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
  'messaging/invalid-recipient',
]);

function init() {
  if (enabled) return enabled;

  try {
    if (!ensureApp()) {
      const initError = getFirebaseInitError();
      console.warn(
        '⚠️  FCM disabled: set FIREBASE_SERVICE_ACCOUNT (or _BASE64), or add backend/config/*-firebase-adminsdk-*.json',
      );
      return false;
    }

    const { getMessaging } = require('firebase-admin/messaging');
    messaging = getMessaging();
    enabled = true;
    console.log('🔔 FCM initialised');
    return true;
  } catch (err) {
    console.error('❌ FCM init failed:', err.message);
    return false;
  }
}

function isEnabled() {
  return enabled;
}

/**
 * Build the FCM message body. All `data` values must be strings.
 *
 * TTL policy (WhatsApp-like):
 * - call invites: short (60s) — stale rings are useless
 * - chat + everything else: long (24h) — must survive offline / Doze
 *
 * Incoming calls use Android high-priority FCM with a notification block so
 * lock-screen / killed phones always show a tray; `data` lets the client
 * upgrade to Answer / Decline via Notifee. iOS keeps an APNs alert + category.
 */
function buildMessage({
  tokens,
  title,
  body,
  imageUrl,
  data = {},
  channelId = 'system',
  priority = 'normal',
  groupKey,
  sound = 'default',
  badge,
  collapseKey,
  ttlMs,
}) {
  const stringData = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;
    stringData[key] =
      typeof value === 'string' ? value : JSON.stringify(value);
  }

  const isHigh = priority === 'high';
  const type = String(stringData.type || channelId || '');
  const resolvedTtl =
    typeof ttlMs === 'number'
      ? ttlMs
      : type === 'call'
        ? 90 * 1000
        : 24 * 60 * 60 * 1000;

  const callAction = String(stringData.action || '').toLowerCase();
  const isCallIncoming =
    type === 'call' && callAction === 'incoming';
  const isCallClear =
    type === 'call' &&
    (callAction === 'clear' || callAction === 'ended' || callAction === 'cancel');
  const isCallMissed =
    type === 'call' &&
    (callAction === 'missed' ||
      stringData.missed === 'true' ||
      stringData.missed === true);

  // Relative `/uploads/...` photos never render in the tray — FCM needs https
  const resolvedImage = absoluteMediaUrl(imageUrl) || undefined;

  // Incoming calls: wake Doze / show heads-up even when app is killed
  const androidPriority =
    isHigh || isCallIncoming || isCallClear || isCallMissed ? 'high' : 'normal';

  // Flatten display fields into data so a background task can rebuild the tray
  if (isCallIncoming) {
    stringData.title = title || stringData.title || 'Incoming call';
    stringData.body = body || stringData.body || '';
    stringData.channelId = channelId || 'calls';
    stringData.categoryId = 'incoming_call';
  }

  const base = {
    tokens,
    data: {
      ...stringData,
      type: stringData.type || type || '',
      ...(isCallIncoming ? { categoryId: 'incoming_call' } : {}),
    },
    android: {
      priority: androidPriority,
      ...(collapseKey || groupKey
        ? { collapseKey: String(collapseKey || groupKey).slice(0, 64) }
        : {}),
      ttl: resolvedTtl,
    },
    apns: {
      headers: {
        'apns-priority':
          isHigh || isCallIncoming || isCallMissed ? '10' : '5',
        'apns-push-type': isCallClear ? 'background' : 'alert',
        'apns-expiration': String(
          Math.floor(Date.now() / 1000) + Math.floor(resolvedTtl / 1000),
        ),
        ...(collapseKey || groupKey
          ? {
              'apns-collapse-id': String(collapseKey || groupKey).slice(0, 64),
            }
          : {}),
      },
      payload: {
        aps: {
          ...(isCallClear
            ? { 'content-available': 1 }
            : {
                sound: sound === 'default' || !sound ? 'default' : `${sound}.caf`,
                ...(typeof badge === 'number' ? { badge } : {}),
                ...(groupKey ? { 'thread-id': groupKey } : {}),
                'mutable-content': resolvedImage ? 1 : 0,
              }),
          ...(isCallIncoming
            ? {
                alert: {
                  title: title || 'Incoming call',
                  body: body || '',
                },
                category: 'incoming_call',
                'interruption-level': 'time-sensitive',
              }
            : {}),
        },
      },
      ...(resolvedImage && !isCallClear
        ? { fcmOptions: { image: resolvedImage } }
        : {}),
    },
  };

  // Clear / cancel: data-only — client dismisses the ringing tray
  if (isCallClear) {
    return {
      ...base,
      android: {
        ...base.android,
        // No notification block → data-only wake on Android
      },
    };
  }

  // Incoming calls:
  // - Always include Android `notification` so lock-screen / killed / Doze
  //   phones show a tray even when JS can't wake (data-only alone is silent
  //   on many OEMs without a live background task).
  // - Keep full `data` so Notifee / TaskManager can upgrade to Answer/Decline
  //   and cancel this generic tray by the same `tag` / callId.
  // - iOS uses APNs alert + category above.
  if (isCallIncoming) {
    const callTitle = title || stringData.title || 'Incoming call';
    const callBody = body || stringData.body || '';
    return {
      ...base,
      notification: {
        title: callTitle,
        body: callBody,
        ...(resolvedImage ? { imageUrl: resolvedImage } : {}),
      },
      android: {
        ...base.android,
        notification: {
          channelId: channelId || 'calls',
          sound: sound === 'default' || !sound ? 'default' : sound,
          priority: 'max',
          defaultVibrateTimings: true,
          visibility: 'PUBLIC',
          ...(groupKey || collapseKey
            ? { tag: String(groupKey || collapseKey).slice(0, 64) }
            : {}),
          ...(resolvedImage ? { imageUrl: resolvedImage } : {}),
          icon: 'notification_icon',
          color: '#5A2FC7',
        },
      },
      apns: base.apns,
    };
  }

  return {
    ...base,
    notification: {
      title,
      body,
      ...(resolvedImage ? { imageUrl: resolvedImage } : {}),
    },
    android: {
      ...base.android,
      notification: {
        channelId,
        sound: sound === 'default' || !sound ? 'default' : sound,
        priority: isHigh || isCallMissed ? 'max' : 'default',
        defaultVibrateTimings: true,
        // 1 = PUBLIC — show content on lock screen (WhatsApp-style)
        // Firebase Admin expects the string enum, not a numeric constant
        visibility: 'PUBLIC',
        ...(typeof badge === 'number' ? { notificationCount: badge } : {}),
        ...(groupKey ? { tag: groupKey } : {}),
        ...(resolvedImage ? { imageUrl: resolvedImage } : {}),
        icon: 'notification_icon',
        color: '#5A2FC7',
      },
    },
    apns: {
      ...base.apns,
      payload: {
        aps: {
          alert: {
            title,
            body,
          },
          sound: sound === 'default' || !sound ? 'default' : `${sound}.caf`,
          ...(typeof badge === 'number' ? { badge } : {}),
          ...(groupKey ? { 'thread-id': groupKey } : {}),
          'mutable-content': resolvedImage ? 1 : 0,
        },
      },
    },
  };
}

/**
 * Send to up to 500 tokens (FCM multicast limit is handled by the caller).
 *
 * @returns {{ok: boolean, successCount: number, failureCount: number,
 *            invalidTokens: string[], retryableTokens: string[],
 *            results: Array<{token: string, success: boolean, errorCode?: string}>}}
 */
async function sendToTokens(tokens, payload) {
  if (!init()) {
    return {
      ok: false,
      successCount: 0,
      failureCount: tokens.length,
      invalidTokens: [],
      retryableTokens: [],
      results: [],
      error: getFirebaseInitError() || 'FCM disabled',
    };
  }

  if (!tokens?.length) {
    return {
      ok: true,
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
      retryableTokens: [],
      results: [],
    };
  }

  const message = buildMessage({ ...payload, tokens });
  const response = await messaging.sendEachForMulticast(message);

  const invalidTokens = [];
  const retryableTokens = [];
  const results = [];

  response.responses.forEach((res, i) => {
    const token = tokens[i];
    if (res.success) {
      results.push({ token, success: true });
      return;
    }
    const code = res.error?.code || 'unknown';
    results.push({ token, success: false, errorCode: code });

    if (PERMANENT_ERROR_CODES.has(code)) {
      invalidTokens.push(token);
    } else {
      retryableTokens.push(token);
    }
  });

  return {
    ok: response.failureCount === 0,
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
    retryableTokens,
    results,
  };
}

/** Topic broadcast — used for global announcements / promos. */
async function sendToTopic(topic, payload) {
  if (!init()) return { ok: false, error: getFirebaseInitError() || 'FCM disabled' };
  const { tokens, ...rest } = buildMessage({ ...payload, tokens: [] });
  const messageId = await messaging.send({ ...rest, topic });
  return { ok: true, messageId };
}

module.exports = {
  init,
  isEnabled,
  sendToTokens,
  sendToTopic,
  PERMANENT_ERROR_CODES,
};
