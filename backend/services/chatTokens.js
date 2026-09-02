/**
 * Chat token session service.
 * 10 tokens → chat session (duration depends on subscription tier).
 * Anti-spam rules: max 10 consecutive messages without reply, can't start new conversations when waiting.
 * Server-time only.
 */
const User = require('../models/User');
const ConversationState = require('../models/ConversationState');
const { getSessionDurationMs, hasUnlimitedChat, getPlanEntitlements } = require('./subscriptions');

const CHAT_TOKEN_COST = 10;
const CHAT_SESSION_MS = 2 * 60 * 60 * 1000; // default free tier
const MAX_CONSECUTIVE_MESSAGES = 10;

const USER_ACCESS_FIELDS =
  'tokenBalance chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt';

function serializeAccess(user, now = new Date()) {
  const ent = getPlanEntitlements(user, now);

  if (ent.unlimitedChat) {
    const subExp = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt)
      : null;
    const remainingMs = subExp
      ? Math.max(0, subExp.getTime() - now.getTime())
      : 0;
    return {
      tokenBalance: user.tokenBalance ?? 0,
      hasActiveSession: true,
      sessionStartedAt: user.chatSessionStartedAt || now,
      sessionExpiresAt: subExp,
      remainingMs,
      canChat: true,
      tokenCost: 0,
      sessionDurationMs: 0,
      unlimitedChat: true,
      subscription: ent,
      serverNow: now.toISOString(),
    };
  }

  const sessionDurationMs = getSessionDurationMs(user, now);
  let expiresAt = user.chatSessionExpiresAt
    ? new Date(user.chatSessionExpiresAt)
    : null;
  if (
    expiresAt &&
    sessionDurationMs &&
    expiresAt.getTime() > now.getTime() + sessionDurationMs
  ) {
    expiresAt = new Date(now.getTime() + sessionDurationMs);
  }
  const hasActiveSession = !!(expiresAt && expiresAt.getTime() > now.getTime());
  const remainingMs = hasActiveSession
    ? Math.max(0, expiresAt.getTime() - now.getTime())
    : 0;

  return {
    tokenBalance: user.tokenBalance ?? 0,
    hasActiveSession,
    sessionStartedAt: hasActiveSession ? user.chatSessionStartedAt : null,
    sessionExpiresAt: hasActiveSession ? expiresAt : null,
    remainingMs,
    canChat: hasActiveSession || (user.tokenBalance ?? 0) >= CHAT_TOKEN_COST,
    tokenCost: ent.chatTokenCost,
    sessionDurationMs,
    unlimitedChat: false,
    subscription: ent,
    serverNow: now.toISOString(),
  };
}

async function getChatAccessStatus(userId) {
  const user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return serializeAccess(user);
}

/**
 * Ensure an active chat session for messaging.
 * - Reuses existing non-expired session (no double charge).
 * - If expired/missing and balance >= 10, atomically deducts and starts 2h session.
 * - If insufficient tokens, returns ok:false with INSUFFICIENT_TOKENS.
 *
 * Short in-memory cache avoids a Mongo round-trip on every chat message.
 */
const sessionCache = new Map(); // userId → { expiresAtMs, payload }

function cacheSession(userId, payload) {
  if (!payload.ok) return;
  const exp = payload.unlimitedChat
    ? payload.sessionExpiresAt
      ? new Date(payload.sessionExpiresAt).getTime()
      : Date.now() + 86400000
    : payload.sessionExpiresAt
      ? new Date(payload.sessionExpiresAt).getTime()
      : 0;
  if (exp > Date.now()) {
    sessionCache.set(String(userId), { expiresAtMs: exp, payload });
  }
}

function getCachedSession(userId) {
  const hit = sessionCache.get(String(userId));
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now() + 30_000) {
    sessionCache.delete(String(userId));
    return null;
  }
  return hit.payload;
}

async function ensureChatSession(userId) {
  const cached = getCachedSession(userId);
  if (cached) return cached;

  const now = new Date();
  let user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // Black plan: unlimited chat — no token deduction
  if (hasUnlimitedChat(user, now)) {
    const subExp = user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (
      !user.chatSessionExpiresAt ||
      new Date(user.chatSessionExpiresAt).getTime() < subExp.getTime()
    ) {
      user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            chatSessionStartedAt: user.chatSessionStartedAt || now,
            chatSessionExpiresAt: subExp,
          },
        },
        { new: true, select: USER_ACCESS_FIELDS },
      );
    }
    const payload = {
      ok: true,
      renewed: false,
      ...serializeAccess(user, now),
    };
    cacheSession(userId, payload);
    return payload;
  }

  // 1) Already have a valid session — no deduction
  user = await User.findOne({
    _id: userId,
    chatSessionExpiresAt: { $gt: now },
  }).select(USER_ACCESS_FIELDS);

  if (user) {
    const sessionMs = getSessionDurationMs(user, now);
    const storedExp = user.chatSessionExpiresAt
      ? new Date(user.chatSessionExpiresAt)
      : null;
    const maxExp = sessionMs ? new Date(now.getTime() + sessionMs) : null;
    if (storedExp && maxExp && storedExp.getTime() > maxExp.getTime()) {
      user = await User.findByIdAndUpdate(
        userId,
        { $set: { chatSessionExpiresAt: maxExp } },
        { new: true, select: USER_ACCESS_FIELDS },
      );
    }
    const payload = {
      ok: true,
      renewed: false,
      ...serializeAccess(user, now),
    };
    cacheSession(userId, payload);
    return payload;
  }

  // No active session — reload user so plan tier hours are applied
  // (Gold 6h / Platinum 12h / Black 24h)
  user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const sessionMs = getSessionDurationMs(user, now);
  if (!sessionMs) {
    const err = new Error('Invalid chat session duration');
    err.status = 500;
    throw err;
  }
  const expiresAt = new Date(now.getTime() + sessionMs);
  user = await User.findOneAndUpdate(
    {
      _id: userId,
      tokenBalance: { $gte: CHAT_TOKEN_COST },
      $or: [
        { chatSessionExpiresAt: null },
        { chatSessionExpiresAt: { $exists: false } },
        { chatSessionExpiresAt: { $lte: now } },
      ],
    },
    {
      $inc: { tokenBalance: -CHAT_TOKEN_COST },
      $set: {
        chatSessionStartedAt: now,
        chatSessionExpiresAt: expiresAt,
      },
    },
    { new: true, select: USER_ACCESS_FIELDS },
  );

  if (user) {
    const payload = {
      ok: true,
      renewed: true,
      ...serializeAccess(user, now),
    };
    cacheSession(userId, payload);
    return payload;
  }

  // 3) Race: another request may have just created a session
  user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const status = serializeAccess(user, now);
  if (status.hasActiveSession) {
    const payload = { ok: true, renewed: false, ...status };
    cacheSession(userId, payload);
    return payload;
  }

  return {
    ok: false,
    code: 'INSUFFICIENT_TOKENS',
    message:
      "You don't have enough tokens to continue chatting. Please purchase more tokens to continue.",
    ...status,
  };
}

/**
 * Helper: generate a consistent room ID from two user IDs
 */
function roomId(a, b) {
  return [String(a), String(b)].sort().join('_');
}

/**
 * Check if a user can send a message in a specific conversation.
 * Enforces the 10 consecutive message limit and cross-chat spam prevention.
 * 
 * @param {string} senderId - User ID of the sender
 * @param {string} receiverId - User ID of the receiver
 * @param {string} messageType - Type of message ('text', 'image', 'audio')
 * @returns {Promise<{ok: boolean, code?: string, message?: string, consecutiveCount?: number}>}
 */
async function canSendMessage(senderId, receiverId, messageType = 'text') {
  const now = new Date();
  const room = roomId(senderId, receiverId);
  
  // 1. Check if user has an active chat session
  const user = await User.findById(senderId).select(
    'chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt',
  );
  if (!user) {
    return {
      ok: false,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    };
  }

  const unlimited = hasUnlimitedChat(user, now);
  const hasActiveSession =
    unlimited ||
    (user.chatSessionExpiresAt &&
      new Date(user.chatSessionExpiresAt).getTime() > now.getTime());

  // Token session is text-only for strangers; Black unlimited skips this cap
  if (hasActiveSession && !unlimited && messageType !== 'text') {
    const Friendship = require('../models/Friendship');
    const { userA, userB } = Friendship.getSortedPair(senderId, receiverId);
    const matched = await Friendship.findOne({
      userA,
      userB,
      status: { $in: ['friends', 'mutual_match'] },
    })
      .select('_id')
      .lean();

    if (!matched) {
      return {
        ok: false,
        code: 'MEDIA_NOT_ALLOWED',
        message: 'Only text messages are allowed during token-based chat sessions. Voice, images, and files are disabled.',
      };
    }
  }

  // 3. Get or create conversation state
  let convState = await ConversationState.findOne({
    userId: senderId,
    otherUserId: receiverId,
  });

  if (!convState) {
    // First message in this conversation - create state
    convState = await ConversationState.create({
      userId: senderId,
      otherUserId: receiverId,
      roomId: room,
      consecutiveMessages: 0,
      waitingForReply: false,
    });
  }

  // 4. Check if user is waiting for reply in THIS conversation
  if (convState.waitingForReply) {
    return {
      ok: false,
      code: 'WAITING_FOR_REPLY',
      message: 'Please wait for the other user to reply before sending more messages.',
      consecutiveCount: convState.consecutiveMessages,
    };
  }

  // 5. Check if user is waiting for reply in ANY OTHER conversation
  const waitingInOtherConv = await ConversationState.findOne({
    userId: senderId,
    otherUserId: { $ne: receiverId },
    waitingForReply: true,
  });

  if (waitingInOtherConv) {
    // User is blocked from starting new conversations or sending first messages
    // Check if the receiver has ever sent a message to this user in this conversation
    const Message = require('../models/Message');
    const hasReceivedMessage = await Message.findOne({
      roomId: room,
      senderId: receiverId,
      receiverId: senderId,
    });

    if (!hasReceivedMessage) {
      // This is a new conversation or user hasn't received any message from receiver
      return {
        ok: false,
        code: 'WAITING_FOR_REPLY_OTHER',
        message: 'You cannot start new conversations while waiting for a reply in another conversation. Please wait for a response first.',
      };
    }
  }

  // 6. All checks passed
  return {
    ok: true,
    consecutiveCount: convState.consecutiveMessages,
  };
}

/**
 * Increment the consecutive message count for a conversation.
 * Called after a message is successfully sent.
 * 
 * @param {string} senderId - User ID of the sender
 * @param {string} receiverId - User ID of the receiver
 */
async function incrementMessageCount(senderId, receiverId) {
  const now = new Date();
  const room = roomId(senderId, receiverId);

  const convState = await ConversationState.findOneAndUpdate(
    {
      userId: senderId,
      otherUserId: receiverId,
    },
    {
      $inc: { consecutiveMessages: 1 },
      $set: { 
        lastMessageAt: now,
        roomId: room, // Ensure roomId is set
      },
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  // If hit the limit, mark as waiting for reply
  if (convState.consecutiveMessages >= MAX_CONSECUTIVE_MESSAGES) {
    await ConversationState.findByIdAndUpdate(convState._id, {
      waitingForReply: true,
    });
  }

  return convState;
}

/**
 * Reset the consecutive message count when the other user replies.
 * Called when a message is received from the other party.
 * 
 * @param {string} senderId - User ID of the person who sent the new message
 * @param {string} receiverId - User ID of the person receiving (whose count should reset)
 */
async function resetMessageCount(senderId, receiverId) {
  const now = new Date();
  
  // Reset the receiver's state for this conversation
  // (receiverId had been sending messages, now senderId replied)
  await ConversationState.findOneAndUpdate(
    {
      userId: receiverId, // The one whose count we're resetting
      otherUserId: senderId, // The one who just replied
    },
    {
      $set: {
        consecutiveMessages: 0,
        waitingForReply: false,
        lastReplyReceivedAt: now,
      },
    },
    { upsert: false } // Don't create if doesn't exist
  );
}

/**
 * Get conversation restrictions for a user.
 * Returns which conversations are blocked and overall status.
 * 
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Conversation restrictions info
 */
async function getConversationRestrictions(userId) {
  const blockedConversations = await ConversationState.find({
    userId,
    waitingForReply: true,
  }).select('otherUserId roomId consecutiveMessages lastMessageAt');

  const hasBlockedConversations = blockedConversations.length > 0;
  
  return {
    hasBlockedConversations,
    blockedConversations: blockedConversations.map(c => ({
      otherUserId: String(c.otherUserId),
      roomId: c.roomId,
      consecutiveMessages: c.consecutiveMessages,
      lastMessageAt: c.lastMessageAt,
    })),
    canStartNewConversations: !hasBlockedConversations,
  };
}

module.exports = {
  CHAT_TOKEN_COST,
  CHAT_SESSION_MS,
  MAX_CONSECUTIVE_MESSAGES,
  getChatAccessStatus,
  ensureChatSession,
  serializeAccess,
  canSendMessage,
  incrementMessageCount,
  resetMessageCount,
  getConversationRestrictions,
};
