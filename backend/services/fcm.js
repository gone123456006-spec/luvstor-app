/**
 * Firebase Cloud Messaging transport.
 * Credentials are shared with firebaseAdmin.js (FCM + Google login).
 */
const {
  ensureApp,
  isFirebaseAdminReady,
  getFirebaseInitError,
} = require('./firebaseAdmin');

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
}) {
  const stringData = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;
    stringData[key] =
      typeof value === 'string' ? value : JSON.stringify(value);
  }

  const isHigh = priority === 'high';

  return {
    tokens,
    notification: {
      title,
      body,
      ...(imageUrl ? { imageUrl } : {}),
    },
    data: stringData,
    android: {
      priority: isHigh ? 'high' : 'normal',
      ...(collapseKey ? { collapseKey } : {}),
      // Drop rather than deliver stale pushes (e.g. a call invite)
      ttl: isHigh ? 60 * 1000 : 24 * 60 * 60 * 1000,
      notification: {
        channelId,
        sound,
        priority: isHigh ? 'max' : 'default',
        defaultVibrateTimings: true,
        ...(groupKey ? { tag: groupKey } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        icon: 'notification_icon',
        color: '#8E2DE2',
      },
    },
    apns: {
      headers: {
        'apns-priority': isHigh ? '10' : '5',
        ...(collapseKey ? { 'apns-collapse-id': collapseKey } : {}),
      },
      payload: {
        aps: {
          sound: sound === 'default' ? 'default' : `${sound}.caf`,
          ...(typeof badge === 'number' ? { badge } : {}),
          ...(groupKey ? { 'thread-id': groupKey } : {}),
          'mutable-content': imageUrl ? 1 : 0,
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
