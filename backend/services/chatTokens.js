/**
 * Chat token session service.
 * 10 tokens → chat session (duration depends on subscription tier).
 * Free tier: per-conversation 2h session — initiator AND replier each pay 10.
 * Paid tiers: global session across chats.
 * Anti-spam rules: max 10 consecutive messages without reply, can't start new conversations when waiting.
 * Server-time only.
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const ConversationState = require('../models/ConversationState');
const {
  getSessionDurationMs,
  hasUnlimitedChat,
  getPlanEntitlements,
  getEffectivePlan,
} = require('./subscriptions');

const CHAT_TOKEN_COST = 10;
const CHAT_SESSION_MS = 2 * 60 * 60 * 1000; // free tier / default
const MAX_CONSECUTIVE_MESSAGES = 10;
/** One-time tokens when a new user finishes create-profile (once ever). */
const WELCOME_PROFILE_TOKENS = 50;
/** One-time tokens when photo verification is approved (once ever). */
const PHOTO_VERIFICATION_TOKENS = 30;
/** Per post-gallery image, first add only (new users). */
const GALLERY_POST_TOKENS_PER_IMAGE = 5;

const USER_ACCESS_FIELDS =
  'tokenBalance chatSessionStartedAt chatSessionExpiresAt subscriptionPlan subscriptionExpiresAt';

function serializeAccess(user, now = new Date(), convSession = null) {
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

  const plan = getEffectivePlan(user, now);
  const useConvSession = plan === 'free' && convSession;

  let expiresAt = null;
  let startedAt = null;
  if (useConvSession) {
    expiresAt = convSession.chatSessionExpiresAt
      ? new Date(convSession.chatSessionExpiresAt)
      : null;
    startedAt = convSession.chatSessionStartedAt
      ? new Date(convSession.chatSessionStartedAt)
      : null;
  } else {
    const sessionDurationMs = getSessionDurationMs(user, now);
    expiresAt = user.chatSessionExpiresAt
      ? new Date(user.chatSessionExpiresAt)
      : null;
    if (
      expiresAt &&
      sessionDurationMs &&
      expiresAt.getTime() > now.getTime() + sessionDurationMs
    ) {
      expiresAt = new Date(now.getTime() + sessionDurationMs);
    }
    startedAt = hasActiveSessionDate(expiresAt, now)
      ? user.chatSessionStartedAt
      : null;
  }

  const hasActiveSession = !!(expiresAt && expiresAt.getTime() > now.getTime());
  const remainingMs = hasActiveSession
    ? Math.max(0, expiresAt.getTime() - now.getTime())
    : 0;
  const sessionDurationMs =
    plan === 'free' ? CHAT_SESSION_MS : getSessionDurationMs(user, now);

  return {
    tokenBalance: user.tokenBalance ?? 0,
    hasActiveSession,
    sessionStartedAt: hasActiveSession ? startedAt : null,
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

function hasActiveSessionDate(expiresAt, now) {
  return !!(expiresAt && expiresAt.getTime() > now.getTime());
}

async function getConversationSession(userId, otherUserId) {
  if (!otherUserId) return null;
  return ConversationState.findOne({
    userId,
    otherUserId,
  }).select('chatSessionStartedAt chatSessionExpiresAt');
}

async function getChatAccessStatus(userId, otherUserId = null) {
  const user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const plan = getEffectivePlan(user);
  const conv =
    plan === 'free' && otherUserId
      ? await getConversationSession(userId, otherUserId)
      : null;
  return serializeAccess(user, new Date(), conv);
}

/**
 * Ensure an active chat session for messaging.
 * - Free + otherUserId: per-conversation 2h window (initiator and replier both pay 10).
 * - Paid: reuses global non-expired session (no double charge).
 * - If expired/missing and balance >= 10, atomically deducts and starts session.
 * - If insufficient tokens, returns ok:false with INSUFFICIENT_TOKENS.
 */
const sessionCache = new Map(); // cacheKey → { expiresAtMs, payload }

function cacheKey(userId, otherUserId) {
  return otherUserId ? `${userId}:${otherUserId}` : String(userId);
}

function cacheSession(userId, payload, otherUserId = null) {
  if (!payload.ok) return;
  const exp = payload.unlimitedChat
    ? payload.sessionExpiresAt
      ? new Date(payload.sessionExpiresAt).getTime()
      : Date.now() + 86400000
    : payload.sessionExpiresAt
      ? new Date(payload.sessionExpiresAt).getTime()
      : 0;
  if (exp > Date.now()) {
    sessionCache.set(cacheKey(userId, otherUserId), {
      expiresAtMs: exp,
      payload,
    });
  }
}

function getCachedSession(userId, otherUserId = null) {
  const hit = sessionCache.get(cacheKey(userId, otherUserId));
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now() + 30_000) {
    sessionCache.delete(cacheKey(userId, otherUserId));
    return null;
  }
  return hit.payload;
}

function roomId(a, b) {
  return [String(a), String(b)].sort().join('_');
}

async function ensureFreeConversationSession(userId, otherUserId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHAT_SESSION_MS);
  const room = roomId(userId, otherUserId);
  const claimId = new mongoose.Types.ObjectId();

  // 1) Already have a valid per-conversation session
  let conv = await ConversationState.findOne({
    userId,
    otherUserId,
    chatSessionExpiresAt: { $gt: now },
  });
  if (conv) {
    const user = await User.findById(userId).select(USER_ACCESS_FIELDS);
    if (!user) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }
    const payload = {
      ok: true,
      renewed: false,
      ...serializeAccess(user, now, conv),
    };
    cacheSession(userId, payload, otherUserId);
    return payload;
  }

  // 2) Deduct 10 tokens (same cost whether starting chat OR replying)
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      tokenBalance: { $gte: CHAT_TOKEN_COST },
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

  if (!user) {
    // Race: another request may have just opened this conversation session
    conv = await ConversationState.findOne({
      userId,
      otherUserId,
      chatSessionExpiresAt: { $gt: now },
    });
    const fresh = await User.findById(userId).select(USER_ACCESS_FIELDS);
    if (!fresh) {
      const err = new Error('User not found');
      err.status = 404;
      throw err;
    }
    if (conv) {
      const payload = {
        ok: true,
        renewed: false,
        ...serializeAccess(fresh, now, conv),
      };
      cacheSession(userId, payload, otherUserId);
      return payload;
    }
    const status = serializeAccess(fresh, now, null);
    return {
      ok: false,
      code: 'INSUFFICIENT_TOKENS',
      message:
        "You don't have enough tokens to reply or continue chatting. Please purchase more tokens to continue.",
      ...status,
    };
  }

  // 3) Attach 2h session to THIS conversation (initiator or replier)
  conv = await ConversationState.findOneAndUpdate(
    {
      userId,
      otherUserId,
      $or: [
        { chatSessionExpiresAt: { $lte: now } },
        { chatSessionExpiresAt: null },
        { chatSessionExpiresAt: { $exists: false } },
      ],
    },
    {
      $set: {
        chatSessionStartedAt: now,
        chatSessionExpiresAt: expiresAt,
        roomId: room,
        sessionClaimId: claimId,
      },
      $setOnInsert: {
        userId,
        otherUserId,
        consecutiveMessages: 0,
        waitingForReply: false,
      },
    },
    { upsert: true, new: true },
  );

  // Lost race: someone else created an active session — refund this charge
  if (
    !conv ||
    !conv.sessionClaimId ||
    String(conv.sessionClaimId) !== String(claimId)
  ) {
    await User.findByIdAndUpdate(userId, {
      $inc: { tokenBalance: CHAT_TOKEN_COST },
    });
    const active = await ConversationState.findOne({
      userId,
      otherUserId,
      chatSessionExpiresAt: { $gt: now },
    });
    const fresh = await User.findById(userId).select(USER_ACCESS_FIELDS);
    if (active && fresh) {
      const payload = {
        ok: true,
        renewed: false,
        ...serializeAccess(fresh, now, active),
      };
      cacheSession(userId, payload, otherUserId);
      return payload;
    }
  }

  const payload = {
    ok: true,
    renewed: true,
    ...serializeAccess(user, now, conv),
  };
  cacheSession(userId, payload, otherUserId);
  return payload;
}

async function ensureGlobalChatSession(userId) {
  const cached = getCachedSession(userId);
  if (cached) return cached;

  const now = new Date();
  let user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

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

async function ensureChatSession(userId, otherUserId = null) {
  const cached = getCachedSession(userId, otherUserId);
  if (cached) return cached;

  const user = await User.findById(userId).select(USER_ACCESS_FIELDS);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const now = new Date();
  if (hasUnlimitedChat(user, now)) {
    return ensureGlobalChatSession(userId);
  }

  const plan = getEffectivePlan(user, now);
  // Free users: each conversation (including replies) needs its own 10-token / 2h session
  if (plan === 'free' && otherUserId) {
    return ensureFreeConversationSession(userId, otherUserId);
  }

  return ensureGlobalChatSession(userId);
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
  
  // 1. Check if user has an active chat session (global or this conversation)
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
  const plan = getEffectivePlan(user, now);
  let hasActiveSession = unlimited;

  if (!hasActiveSession && plan === 'free') {
    const conv = await ConversationState.findOne({
      userId: senderId,
      otherUserId: receiverId,
    }).select('chatSessionExpiresAt');
    hasActiveSession = !!(
      conv?.chatSessionExpiresAt &&
      new Date(conv.chatSessionExpiresAt).getTime() > now.getTime()
    );
  } else if (!hasActiveSession) {
    hasActiveSession = !!(
      user.chatSessionExpiresAt &&
      new Date(user.chatSessionExpiresAt).getTime() > now.getTime()
    );
  }

  // Image / voice unlock only after both users have sent a DM
  if (
    hasActiveSession &&
    !unlimited &&
    (messageType === 'image' || messageType === 'audio')
  ) {
    const { hasBidirectionalChat } = require('../utils/chatMediaAccess');
    const bothMessaged = await hasBidirectionalChat(senderId, receiverId);
    if (!bothMessaged) {
      return {
        ok: false,
        code: 'MEDIA_LOCKED',
        message: 'Photos and voice unlock when they reply to your message.',
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
  WELCOME_PROFILE_TOKENS,
  PHOTO_VERIFICATION_TOKENS,
  GALLERY_POST_TOKENS_PER_IMAGE,
  getChatAccessStatus,
  ensureChatSession,
  serializeAccess,
  canSendMessage,
  incrementMessageCount,
  resetMessageCount,
  getConversationRestrictions,
};
