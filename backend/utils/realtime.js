/**
 * Notify a user on every connected socket (any server instance).
 * Uses Socket.IO room `user:{id}` so Redis adapter fans out correctly.
 */
function notifyUser(io, userId, event, payload) {
  if (!io || !userId) return;
  const uid = String(userId);
  io.to(`user:${uid}`).emit(event, payload);
}

/**
 * Broadcast an event to every currently online user (optionally skip one id).
 * Prefer rooms when Redis presence is available; else local Maps.
 */
async function broadcastOnline(io, event, payload, skipUserId = null) {
  if (!io) return;
  const skip = skipUserId ? String(skipUserId) : null;

  try {
    const { isReady } = require('./redis');
    const presence = require('./presence');
    if (isReady()) {
      const redis = await require('./redis').getRedis();
      if (redis) {
        const ids = await redis.smembers('presence:online');
        for (const uid of ids) {
          if (skip && uid === skip) continue;
          io.to(`user:${uid}`).emit(event, payload);
        }
        return;
      }
    }
  } catch {
    /* fall through */
  }

  const onlineUsers = io.onlineUsers;
  if (!(onlineUsers instanceof Map)) return;
  for (const [uid] of onlineUsers.entries()) {
    if (skip && uid === skip) continue;
    io.to(`user:${uid}`).emit(event, payload);
  }
}

/**
 * Build a small actor payload for friend / chat notifications.
 */
async function actorPayload(User, fromUserId) {
  const from = await User.findById(fromUserId)
    .select('name photo gender')
    .lean();
  return {
    fromUserId: String(fromUserId),
    fromName: from?.name || 'Someone',
    fromPhoto: from?.photo || '',
    fromGender: from?.gender || '',
  };
}

/**
 * Emit friend:update to the other party (like / unlike / friends / decline / block).
 */
async function emitFriendUpdate(io, User, toUserId, fromUserId, action, status) {
  const actor = await actorPayload(User, fromUserId);
  let payload = {
    ...actor,
    action, // 'like' | 'unlike' | 'friends' | 'decline' | 'block' | 'unblock'
    status,
  };

  try {
    const { getBlockState } = require('./blockState');
    const block = await getBlockState(toUserId, fromUserId);
    // Recipient was blocked by the actor → hide actor DP (WhatsApp)
    if (block.theyBlocked || action === 'block') {
      payload = {
        ...payload,
        fromPhoto: '',
        privacyHidden: true,
      };
    }
  } catch {
    /* keep original payload */
  }

  notifyUser(io, toUserId, 'friend:update', payload);
}

/**
 * Silent status sync for the actor (sender) — keeps other devices in sync without a toast.
 */
async function emitFriendSync(io, User, actorUserId, otherUserId, status) {
  const actor = await actorPayload(User, otherUserId);
  notifyUser(io, actorUserId, 'friend:update', {
    ...actor,
    action: 'sync',
    status,
    silent: true,
    otherUserId: String(otherUserId),
  });
}

/**
 * Broadcast profile field changes so Discover / Chat / open chats refresh.
 * Recipients who were blocked by this user get a WhatsApp-style redacted
 * payload (no DP / online signals).
 */
async function emitProfileUpdate(io, user) {
  if (!user || !io) return;
  const userId = String(user._id || user.id);
  const fullPayload = {
    userId,
    publicId: user.publicId || '',
    name: user.name || '',
    bio: user.bio || '',
    photo: user.photo || '',
    photos: user.photos || [],
    age: user.age ?? null,
    gender: user.gender || '',
    height: user.height ?? null,
    interests: Array.isArray(user.interests) ? user.interests : [],
    relationshipGoal: user.relationshipGoal || '',
    privacyHidden: false,
  };

  const redactedPayload = {
    ...fullPayload,
    photo: '',
    photos: [],
    isOnline: false,
    privacyHidden: true,
  };

  const onlineUsers = io.onlineUsers;
  if (!(onlineUsers instanceof Map)) {
    notifyUser(io, userId, 'profile:update', fullPayload);
    return;
  }

  const { getBlockState } = require('./blockState');

  for (const [uid, sockId] of onlineUsers.entries()) {
    if (!sockId) continue;
    if (uid === userId) {
      io.to(sockId).emit('profile:update', fullPayload);
      continue;
    }
    try {
      const block = await getBlockState(uid, userId);
      // Viewer was blocked by profile owner → WhatsApp gray silhouette
      if (block.theyBlocked) {
        io.to(sockId).emit('profile:update', redactedPayload);
      } else {
        io.to(sockId).emit('profile:update', fullPayload);
      }
    } catch {
      io.to(sockId).emit('profile:update', fullPayload);
    }
  }
}

module.exports = {
  notifyUser,
  broadcastOnline,
  actorPayload,
  emitFriendUpdate,
  emitFriendSync,
  emitProfileUpdate,
};
