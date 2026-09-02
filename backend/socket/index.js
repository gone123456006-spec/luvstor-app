const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const { 
  ensureChatSession, 
  canSendMessage, 
  incrementMessageCount, 
  resetMessageCount 
} = require('../services/chatTokens');
const { createNotification } = require('../services/notifications');
const { getBlockState } = require('../utils/blockState');
const {
  markViewing,
  clearViewing,
  isViewingChat,
  getViewingSet,
} = require('../utils/activeChat');
const presence = require('../utils/presence');
const { notifyUser } = require('../utils/realtime');
const { isReady: redisReady } = require('../utils/redis');
const calls = require('../services/calls');
const exploreMatchmaking = require('../services/exploreMatchmaking');

// Helper: mutual like / friends (media + calls unlock)
async function areFriends(userId1, userId2) {
  const { userA, userB } = Friendship.getSortedPair(userId1, userId2);
  const friendship = await Friendship.findOne({
    userA,
    userB,
    status: { $in: ['friends', 'mutual_match'] },
  });
  return !!friendship;
}

// Helper: generate a consistent room ID from two user IDs
function roomId(a, b) {
  return [String(a), String(b)].sort().join('_');
}

const MAX_MEDIA_THUMB_CHARS = 16000;

function sanitizeMediaThumb(raw) {
  if (typeof raw !== 'string') return null;
  const thumb = raw.trim();
  if (!thumb || thumb.length > MAX_MEDIA_THUMB_CHARS) return null;
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(thumb)) return null;
  return thumb;
}

/** Reply quotes must never expose view-once media. */
function shapeReplyToSnapshot(parent) {
  if (!parent) return null;
  const isViewOnce = !!parent.viewOnce;
  return {
    _id: parent._id,
    senderId: parent.senderId,
    text: parent.isDeleted ? '' : parent.text || '',
    type: parent.type || 'text',
    mediaUrl:
      parent.isDeleted || isViewOnce
        ? null
        : parent.mediaUrl || null,
    isDeleted: !!parent.isDeleted,
    viewOnce: isViewOnce,
    viewOnceOpened: !!parent.viewOnceOpened,
    createdAt: parent.createdAt,
  };
}

const REPLY_TO_SELECT =
  'senderId text type mediaUrl isDeleted viewOnce viewOnceOpened createdAt';

module.exports = function initSocket(io) {
  calls.setIo(io);

  // Map: userId → socket.id (latest socket for direct messaging)
  const onlineUsers = new Map();
  // Map: userId → Set of socket.ids (support SocketContext + chat screen sockets)
  const onlineSockets = new Map();
  // Expose for REST routes (e.g. delete notify)
  io.onlineUsers = onlineUsers;
  io.onlineSockets = onlineSockets;
  const setPrimarySocket = (userId) => {
    const set = onlineSockets.get(String(userId));
    if (set && set.size > 0) {
      onlineUsers.set(String(userId), [...set][set.size - 1]);
    } else {
      onlineUsers.delete(String(userId));
    }
  };

  // JWT + single-device auth middleware for Socket.IO
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication error: No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.userId || !decoded.deviceId) {
        return next(new Error('Authentication error: Invalid token'));
      }
      const user = await User.findById(decoded.userId).select('activeDeviceId');
      if (!user || !user.activeDeviceId || user.activeDeviceId !== decoded.deviceId) {
        return next(new Error('Authentication error: Device mismatch'));
      }
      socket.userId = String(decoded.userId);
      socket.deviceId = String(decoded.deviceId);
      next();
    } catch {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.userId;
    console.log(`✅ Socket connected: ${uid}`);

    // Room used by notifyUser across all horizontally scaled nodes
    socket.join(`user:${uid}`);

    const existing = onlineSockets.get(uid) || new Set();
    existing.add(socket.id);
    onlineSockets.set(uid, existing);
    setPrimarySocket(uid);

    const presenceState = await presence.socketConnected(uid);
    const becameOnline = redisReady()
      ? presenceState.becameOnline
      : existing.size === 1;

    if (becameOnline) {
      await User.findByIdAndUpdate(uid, { isOnline: true, lastSeen: new Date() });
      // Instant presence for Discover / Chat / open chats (all other sockets)
      socket.broadcast.emit('user:online', { userId: uid, isOnline: true });

      // Flush pending deliveries → single tick becomes double gray for senders
      try {
        const pending = await Message.find({
          receiverId: uid,
          delivered: { $ne: true },
          undelivered: { $ne: true },
          isDeleted: { $ne: true },
          deletedFor: { $nin: [uid] },
        })
          .select('_id senderId')
          .lean();

        if (pending.length) {
          const now = new Date();
          const ids = pending.map((m) => m._id);
          await Message.updateMany(
            { _id: { $in: ids } },
            { $set: { delivered: true, deliveredAt: now } },
          );

          const bySender = new Map();
          for (const m of pending) {
            const sid = String(m.senderId);
            if (!bySender.has(sid)) bySender.set(sid, []);
            bySender.get(sid).push(String(m._id));
          }
          for (const [senderId, messageIds] of bySender.entries()) {
            notifyUser(io, senderId, 'chat:delivered', { by: uid, messageIds });
          }
        }
      } catch (err) {
        console.error('flush deliveries error:', err.message);
      }
    }

    // Also notify active chat rooms (skip blocked pairs — both look offline)
    const activeChatSet = await getViewingSet(uid);
    for (const otherUserId of activeChatSet) {
      try {
        const block = await getBlockState(uid, otherUserId);
        if (block.blocked) continue;
        const room = [String(uid), String(otherUserId)].sort().join('_');
        io.to(room).emit('user:online', { userId: uid, isOnline: true });
      } catch {
        /* ignore */
      }
    }

    // ── Join a chat room ──────────────────────────────
    socket.on('chat:join', async ({ otherUserId }) => {
      try {
        if (!otherUserId) return;
        const room = String([String(uid), String(otherUserId)].sort().join('_'));
        socket.join(room);
        console.log(`📌 ${uid} joined room ${room}`);

        // Only the joining user is "viewing" — WhatsApp: suppress their pushes only
        await markViewing(uid, otherUserId);

        const block = await getBlockState(uid, otherUserId);
        if (block.blocked) {
          // Blocked either way → both sides always look offline
          socket.emit('user:offline', {
            userId: String(otherUserId),
            isOnline: false,
          });
          return;
        }

        let otherOnline = false;
        const redisOnline = await presence.isUserOnline(otherUserId);
        if (redisOnline !== null) {
          otherOnline = redisOnline;
        } else {
          otherOnline =
            onlineSockets.has(String(otherUserId)) &&
            (onlineSockets.get(String(otherUserId))?.size || 0) > 0;
        }
        socket.emit(otherOnline ? 'user:online' : 'user:offline', {
          userId: String(otherUserId),
          isOnline: otherOnline,
        });

        io.to(room).emit('user:online', { userId: uid, isOnline: true });
      } catch (err) {
        console.error('chat:join error:', err.message);
      }
    });

    // ── Leave a chat room (restore pushes) ────────────
    socket.on('chat:leave', async ({ otherUserId } = {}) => {
      try {
        if (otherUserId) {
          const room = String([String(uid), String(otherUserId)].sort().join('_'));
          socket.leave(room);
          await clearViewing(uid, otherUserId);
          console.log(`📌 ${uid} left room ${room}`);
        } else {
          await clearViewing(uid);
        }
      } catch (err) {
        console.error('chat:leave error:', err.message);
      }
    });

    // ── Send a message ────────────────────────────────
    socket.on('chat:message', async (data) => {
      try {
        const {
          receiverId,
          text,
          type = 'text',
          mediaUrl = null,
          clientMsgId,
          replyTo = null,
          viewOnce = false,
          mediaThumb = null,
        } = data;
        if (!receiverId || (!text && !mediaUrl)) return;

        if (String(receiverId) === String(uid)) {
          return socket.emit('chat:error', { error: 'Cannot send message to yourself' });
        }

        // One friendship read for block state (was two round-trips)
        const block = await getBlockState(uid, receiverId);
        if (block.iBlocked) {
          return socket.emit('chat:error', {
            error: 'Unblock this person to send messages',
            code: 'BLOCKED',
          });
        }
        const undelivered = !!block.theyBlocked;

        // Session + anti-spam in parallel
        const [access, canSend] = await Promise.all([
          ensureChatSession(uid),
          undelivered
            ? Promise.resolve({ ok: true })
            : canSendMessage(uid, receiverId, type),
        ]);

        if (!access.ok) {
          return socket.emit('chat:error', {
            error: access.message,
            code: access.code || 'INSUFFICIENT_TOKENS',
            tokenBalance: access.tokenBalance,
            remainingMs: access.remainingMs,
            sessionExpiresAt: access.sessionExpiresAt,
          });
        }

        if (type !== 'text') {
          if (undelivered) {
            return socket.emit('chat:error', {
              error: 'Only text messages can be sent while blocked.',
              code: 'BLOCKED_MEDIA',
            });
          }
          const friendsStatus = await areFriends(uid, receiverId);
          if (!friendsStatus) {
            return socket.emit('chat:error', {
              error: 'Only friends can send images, voice messages, and files. Send a like and become friends first!',
              code: 'NOT_FRIENDS',
              requiresFriendship: true,
            });
          }
        }

        if (!canSend.ok) {
          return socket.emit('chat:error', {
            error: canSend.message,
            code: canSend.code,
            consecutiveCount: canSend.consecutiveCount,
          });
        }

        const room = String([String(uid), String(receiverId)].sort().join('_'));
        let receiverOnline = false;
        if (!undelivered) {
          const redisOnline = await presence.isUserOnline(receiverId);
          if (redisOnline !== null) {
            receiverOnline = redisOnline;
          } else {
            receiverOnline =
              onlineSockets.has(String(receiverId)) &&
              (onlineSockets.get(String(receiverId))?.size || 0) > 0;
          }
        }
        const now = new Date();

        let replyToId = null;
        let replyToPayload = null;
        if (replyTo && String(replyTo).match(/^[0-9a-f]{24}$/i)) {
          const parent = await Message.findById(replyTo)
            .select(`roomId ${REPLY_TO_SELECT}`)
            .lean();
          if (parent && parent.roomId === room) {
            replyToId = parent._id;
            replyToPayload = shapeReplyToSnapshot(parent);
          }
        }

        const isViewOnce = !!(viewOnce && type === 'image');
        const liveThumb = isViewOnce ? null : sanitizeMediaThumb(mediaThumb);
        const message = await Message.create({
          roomId: room,
          senderId: uid,
          receiverId,
          text: text || '',
          type,
          mediaUrl,
          undelivered,
          delivered: !!receiverOnline,
          deliveredAt: receiverOnline ? now : null,
          read: false,
          replyTo: replyToId,
          viewOnce: isViewOnce,
          viewOnceOpened: false,
        });

        const payload = {
          _id: message._id,
          roomId: room,
          senderId: uid,
          receiverId,
          text: message.text,
          type: message.type,
          mediaUrl: message.mediaUrl,
          delivered: !!message.delivered,
          read: !!message.read,
          undelivered: !!message.undelivered,
          createdAt: message.createdAt,
          clientMsgId,
          replyTo: replyToPayload,
          viewOnce: !!message.viewOnce,
          viewOnceOpened: !!message.viewOnceOpened,
          mediaThumb: liveThumb || undefined,
        };
        const receiverPayload = message.viewOnce
          ? { ...payload, mediaUrl: null, mediaThumb: undefined }
          : payload;

        // WhatsApp-feel: ack + deliver FIRST, side-effects after
        socket.emit('chat:message', payload);

        if (!undelivered) {
          socket.to(room).emit('chat:message', receiverPayload);
          notifyUser(io, receiverId, 'chat:message', receiverPayload);
          if (message.delivered) {
            socket.emit('chat:delivered', {
              by: String(receiverId),
              messageIds: [String(message._id)],
            });
          }
        }

        // Heavy work off the critical path
        setImmediate(() => {
          (async () => {
            try {
              if (!undelivered) {
                const ConversationState = require('../models/ConversationState');
                await Promise.all([
                  incrementMessageCount(uid, receiverId),
                  resetMessageCount(uid, receiverId),
                  ConversationState.updateOne(
                    { userId: receiverId, otherUserId: uid },
                    {
                      $set: {
                        clearedAt: null,
                        archived: false,
                        archivedAt: null,
                        roomId: room,
                      },
                    },
                  ),
                ]);

                const preview =
                  message.viewOnce
                    ? '📷 View once photo'
                    : message.type === 'image'
                      ? '📷 Photo'
                      : message.type === 'audio'
                        ? '🎵 Voice message'
                        : message.text || 'New message';
                const recipientInChat = await isViewingChat(receiverId, uid);

                await createNotification(io, {
                  userId: receiverId,
                  type: 'chat',
                  title: 'New message',
                  body: preview,
                  actorId: uid,
                  groupKey: `chat:${room}`,
                  deepLink: `/messages/${uid}`,
                  push: !recipientInChat,
                  data: {
                    screen: 'messages',
                    userId: String(uid),
                    roomId: room,
                  },
                });
              }
            } catch (err) {
              console.error('chat:message side-effects error:', err.message);
            }
          })();
        });
      } catch (err) {
        console.error('chat:message error:', err);
        socket.emit('chat:error', { error: 'Failed to send message' });
      }
    });

    // Tiny JPEG preview while the full photo is still uploading (not stored)
    socket.on('chat:image-preview', async (data = {}) => {
      try {
        const receiverId = data.receiverId;
        const clientMsgId = data.clientMsgId;
        if (!receiverId || !clientMsgId) return;
        if (String(receiverId) === String(uid)) return;

        const block = await getBlockState(uid, receiverId);
        if (block.iBlocked || block.theyBlocked) return;
        if (!(await areFriends(uid, receiverId))) return;

        const room = String([String(uid), String(receiverId)].sort().join('_'));
        if (data.cancelled) {
          const payload = {
            senderId: uid,
            receiverId,
            clientMsgId,
            cancelled: true,
          };
          socket.to(room).emit('chat:image-preview', payload);
          notifyUser(io, receiverId, 'chat:image-preview', payload);
          return;
        }

        if (data.viewOnce) return;
        const mediaThumb = sanitizeMediaThumb(data.mediaThumb);
        if (!mediaThumb) return;

        const payload = {
          senderId: uid,
          receiverId,
          clientMsgId,
          type: 'image',
          mediaThumb,
          createdAt: Date.now(),
        };
        socket.to(room).emit('chat:image-preview', payload);
        notifyUser(io, receiverId, 'chat:image-preview', payload);
      } catch (err) {
        console.error('chat:image-preview error:', err.message);
      }
    });

    // ── View-once photo open (receiver only, one time) ─
    socket.on('chat:view-once-open', async (data = {}) => {
      try {
        const messageId = data.messageId;
        if (!messageId || !String(messageId).match(/^[0-9a-f]{24}$/i)) {
          return socket.emit('chat:view-once-open', {
            messageId,
            error: 'INVALID',
          });
        }

        const message = await Message.findById(messageId);
        if (!message || !message.viewOnce || message.type !== 'image') {
          return socket.emit('chat:view-once-open', {
            messageId,
            error: 'NOT_FOUND',
          });
        }
        if (String(message.receiverId) !== String(uid)) {
          return socket.emit('chat:view-once-open', {
            messageId,
            error: 'FORBIDDEN',
          });
        }
        if (message.viewOnceOpened) {
          return socket.emit('chat:view-once-open', {
            messageId,
            error: 'ALREADY_OPENED',
            viewOnceOpened: true,
            mediaUrl: null,
          });
        }

        message.viewOnceOpened = true;
        message.viewOnceOpenedAt = new Date();
        await message.save();

        const mediaUrl = message.mediaUrl || null;
        socket.emit('chat:view-once-open', {
          messageId: String(message._id),
          mediaUrl,
          viewOnceOpened: true,
        });

        const openedPayload = {
          messageId: String(message._id),
          viewOnceOpened: true,
          by: String(uid),
        };
        socket.to(message.roomId).emit('chat:view-once-opened', openedPayload);
        notifyUser(io, message.senderId, 'chat:view-once-opened', openedPayload);
      } catch (err) {
        console.error('chat:view-once-open error:', err);
        socket.emit('chat:view-once-open', {
          messageId: data?.messageId,
          error: 'FAILED',
        });
      }
    });

    // ── Voice / video calling (WebRTC signaling) ──────
    socket.on('call:invite', async (payload = {}) => {
      try {
        const { receiverId, callType = 'voice', callId: preferredId } = payload;
        if (!receiverId) return;
        if (!['voice', 'video'].includes(callType)) return;

        const block = await getBlockState(uid, receiverId);
        if (block.blocked) {
          socket.emit('call:error', {
            error: block.iBlocked
              ? 'Unblock this person to call them'
              : 'You cannot call this person',
            code: 'BLOCKED',
          });
          return;
        }

        if (!(await areFriends(uid, receiverId))) {
          socket.emit('call:error', {
            error: 'You can only call friends',
            code: 'NOT_FRIENDS',
          });
          return;
        }

        // Callee offline → unavailable (still create history via startOutgoing busy path skip)
        let calleeOnline = false;
        const redisOnline = await presence.isUserOnline(receiverId);
        if (redisOnline !== null) {
          calleeOnline = redisOnline;
        } else {
          calleeOnline =
            onlineSockets.has(String(receiverId)) &&
            (onlineSockets.get(String(receiverId))?.size || 0) > 0;
        }

        const room = roomId(uid, receiverId);
        const result = await calls.startOutgoing({
          callerId: uid,
          calleeId: receiverId,
          callType,
          callId: preferredId,
          roomId: room,
        });

        if (!result.ok) {
          socket.emit('call:error', {
            error: result.error,
            code: result.code,
            callId: result.callId,
          });
          if (result.code === 'BUSY') {
            notifyUser(io, receiverId, 'call:missed_busy', {
              from: uid,
              callType,
            });
          }
          return;
        }

        if (!calleeOnline) {
          await calls.destroySession(result.session.callId, {
            status: 'unavailable',
            endReason: 'offline',
            endedBy: null,
          });
          socket.emit('call:error', {
            error: 'User is offline',
            code: 'OFFLINE',
            callId: result.session.callId,
          });
          await createNotification(io, {
            userId: receiverId,
            type: 'call',
            title: 'Missed call',
            body: callType === 'video' ? 'Missed video call' : 'Missed voice call',
            actorId: uid,
            priority: 'high',
            groupKey: `call:missed:${room}`,
            deepLink: `/messages/${uid}`,
            data: {
              screen: 'messages',
              userId: String(uid),
              callId: result.session.callId,
              callType,
              missed: true,
            },
          });
          return;
        }

        const incomingPayload = {
          callId: result.session.callId,
          from: uid,
          callType: result.session.callType,
          roomId: room,
          caller: result.caller,
          iceServers: result.iceServers,
          ringTimeoutMs: result.ringTimeoutMs,
        };

        notifyUser(io, receiverId, 'call:incoming', incomingPayload);

        // High-priority push — wake device / show incoming when backgrounded
        await createNotification(io, {
          userId: receiverId,
          type: 'call',
          title: result.caller.name || 'Incoming call',
          body: callType === 'video' ? 'Incoming video call' : 'Incoming voice call',
          actorId: uid,
          priority: 'high',
          groupKey: `call:${result.session.callId}`,
          deepLink: `/messages/${uid}`,
          data: {
            screen: 'call',
            userId: String(uid),
            roomId: room,
            callId: result.session.callId,
            callType,
            action: 'incoming',
          },
        });

        socket.emit('call:ringing', {
          callId: result.session.callId,
          receiverId: String(receiverId),
          callee: result.callee,
          iceServers: result.iceServers,
          ringTimeoutMs: result.ringTimeoutMs,
          callType: result.session.callType,
        });
      } catch (err) {
        console.error('call:invite error:', err.message);
        socket.emit('call:error', { error: 'Could not start the call', code: 'ERROR' });
      }
    });

    socket.on('call:accept', async ({ callId } = {}) => {
      try {
        if (!callId) return;
        const result = await calls.acceptCall(callId, uid);
        if (!result.ok) {
          socket.emit('call:error', { error: result.error, code: result.code, callId });
          return;
        }
        const session = result.session;
        const otherId = calls.otherParty(session, uid);
        notifyUser(io, otherId, 'call:accepted', {
          callId,
          from: uid,
          iceServers: result.iceServers,
          session,
        });
        socket.emit('call:accepted', {
          callId,
          from: uid,
          iceServers: result.iceServers,
          session,
          isCallee: true,
        });
      } catch (err) {
        console.error('call:accept error:', err.message);
        socket.emit('call:error', { error: 'Could not accept call', callId });
      }
    });

    socket.on('call:decline', async ({ callId } = {}) => {
      try {
        if (!callId) return;
        const session = calls.getSession(callId);
        if (!session || !calls.isParticipant(session, uid)) return;
        await calls.destroySession(callId, {
          status: 'rejected',
          endReason: 'decline',
          endedBy: uid,
        });
      } catch (err) {
        console.error('call:decline error:', err.message);
      }
    });

    socket.on('call:cancel', async ({ callId } = {}) => {
      try {
        if (!callId) return;
        const session = calls.getSession(callId);
        if (!session || String(session.callerId) !== String(uid)) return;
        await calls.destroySession(callId, {
          status: 'cancelled',
          endReason: 'cancel',
          endedBy: uid,
        });
      } catch (err) {
        console.error('call:cancel error:', err.message);
      }
    });

    socket.on('call:end', async ({ callId } = {}) => {
      try {
        if (!callId) return;
        const session = calls.getSession(callId);
        if (!session || !calls.isParticipant(session, uid)) return;
        const status =
          session.status === 'ringing'
            ? String(uid) === session.callerId
              ? 'cancelled'
              : 'rejected'
            : 'ended';
        const endReason =
          session.status === 'ringing'
            ? String(uid) === session.callerId
              ? 'cancel'
              : 'decline'
            : 'hangup';
        await calls.destroySession(callId, { status, endReason, endedBy: uid });
      } catch (err) {
        console.error('call:end error:', err.message);
      }
    });

    // Legacy alias (older clients)
    socket.on('call:respond', async ({ receiverId, callId, action } = {}) => {
      if (!callId || !action) return;
      if (action === 'accept') {
        const result = await calls.acceptCall(callId, uid);
        if (!result.ok) {
          socket.emit('call:error', { error: result.error, code: result.code, callId });
          return;
        }
        const otherId = calls.otherParty(result.session, uid);
        notifyUser(io, otherId, 'call:accepted', {
          callId,
          from: uid,
          iceServers: result.iceServers,
          session: result.session,
        });
        socket.emit('call:accepted', {
          callId,
          from: uid,
          iceServers: result.iceServers,
          session: result.session,
          isCallee: true,
        });
        return;
      }
      if (action === 'decline') {
        await calls.destroySession(callId, {
          status: 'rejected',
          endReason: 'decline',
          endedBy: uid,
        });
        return;
      }
      if (action === 'end') {
        const session = calls.getSession(callId);
        if (!session) {
          if (receiverId) {
            notifyUser(io, receiverId, 'call:ended', {
              callId,
              status: 'ended',
              endReason: 'hangup',
              endedBy: uid,
            });
          }
          return;
        }
        await calls.destroySession(callId, {
          status: session.status === 'ringing' ? 'cancelled' : 'ended',
          endReason: session.status === 'ringing' ? 'cancel' : 'hangup',
          endedBy: uid,
        });
      }
    });

    socket.on('call:offer', ({ callId, sdp } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid) || !sdp) return;
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:offer', { callId, sdp, from: uid });
    });

    socket.on('call:answer', ({ callId, sdp } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid) || !sdp) return;
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:answer', { callId, sdp, from: uid });
    });

    socket.on('call:ice-candidate', ({ callId, candidate } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid) || !candidate) return;
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:ice-candidate', {
        callId,
        candidate,
        from: uid,
      });
    });

    socket.on('call:renegotiate', ({ callId, sdp, callType } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid) || !sdp) return;
      if (callType === 'voice' || callType === 'video') {
        session.callType = callType;
      }
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:renegotiate', {
        callId,
        sdp,
        callType: session.callType,
        from: uid,
      });
    });

    socket.on('call:media-state', ({ callId, muted, cameraOff, speaker } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid)) return;
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:media-state', {
        callId,
        from: uid,
        muted: !!muted,
        cameraOff: cameraOff !== undefined ? !!cameraOff : undefined,
        speaker: speaker !== undefined ? !!speaker : undefined,
      });
    });

    socket.on('call:connected', async ({ callId } = {}) => {
      if (!callId) return;
      const result = await calls.markConnected(callId, uid);
      if (!result.ok) return;
      const otherId = calls.otherParty(result.session, uid);
      notifyUser(io, otherId, 'call:connected', { callId, from: uid });
      socket.emit('call:connected', { callId, from: uid });
    });

    socket.on('call:heartbeat', ({ callId } = {}) => {
      if (!callId) return;
      calls.touchHeartbeat(callId, uid);
    });

    socket.on('call:quality', ({ callId, quality } = {}) => {
      const session = calls.getSession(callId);
      if (!session || !calls.isParticipant(session, uid)) return;
      const otherId = calls.otherParty(session, uid);
      notifyUser(io, otherId, 'call:quality', {
        callId,
        from: uid,
        quality: quality || 'unknown',
      });
    });

    // ── Anonymous Explore (random voice / video) ───────
    socket.on('explore:join', async ({ callType = 'voice' } = {}) => {
      try {
        const type = callType === 'video' ? 'video' : 'voice';

        if (calls.getActiveCallForUser(uid)) {
          socket.emit('explore:error', {
            error: 'You are already in a call',
            code: 'BUSY',
          });
          return;
        }

        exploreMatchmaking.joinQueue(uid, type);
        socket.emit('explore:searching', { callType: type });

        const result = await exploreMatchmaking.tryMatch(io, notifyUser, type);
        if (result && !result.ok) {
          exploreMatchmaking.leaveQueue(uid);
          socket.emit('explore:error', {
            error: result.error || 'Could not start call',
            code: result.code || 'ERROR',
          });
        }
      } catch (err) {
        console.error('explore:join error:', err.message);
        exploreMatchmaking.leaveQueue(uid);
        socket.emit('explore:error', {
          error: 'Explore matchmaking failed',
          code: 'ERROR',
        });
      }
    });

    socket.on('explore:skip', () => {
      exploreMatchmaking.leaveQueue(uid);
      socket.emit('explore:idle');
    });

    socket.on('explore:leave', () => {
      exploreMatchmaking.leaveQueue(uid);
      socket.emit('explore:idle');
    });

    // ── Typing indicator ──────────────────────────────
    socket.on('chat:typing', async ({ receiverId, isTyping }) => {
      try {
        if (!receiverId) return;
        const block = await getBlockState(uid, receiverId);
        // Don't show typing across a block (either direction)
        if (block.blocked) return;
        const room = String([String(uid), String(receiverId)].sort().join('_'));
        socket.to(room).emit('chat:typing', { senderId: uid, isTyping });
      } catch {
        /* ignore */
      }
    });

    // ── Mark messages as read ─────────────────────────
    socket.on('chat:read', async ({ otherUserId }) => {
      try {
        if (!otherUserId) return;
        const room = String([String(uid), String(otherUserId)].sort().join('_'));
        const now = new Date();

        // Ensure delivered + read (WhatsApp blue ticks)
        const unread = await Message.find({
          roomId: room,
          receiverId: uid,
          read: { $ne: true },
          undelivered: { $ne: true },
          isDeleted: { $ne: true },
          deletedFor: { $nin: [uid] },
        })
          .select('_id')
          .lean();

        if (unread.length) {
          const messageIds = unread.map((m) => String(m._id));
          await Message.updateMany(
            { _id: { $in: unread.map((m) => m._id) } },
            {
              $set: {
                delivered: true,
                deliveredAt: now,
                read: true,
                readAt: now,
              },
            },
          );

          const payload = { by: uid, messageIds, roomId: room };
          socket.to(room).emit('chat:read', payload);
          const otherSet = onlineSockets.get(String(otherUserId));
          if (otherSet && otherSet.size) {
            for (const sockId of otherSet) {
              io.to(sockId).emit('chat:read', payload);
            }
          } else {
            const otherSock = onlineUsers.get(String(otherUserId));
            if (otherSock) io.to(otherSock).emit('chat:read', payload);
          }
        }

        // Keep the notification badge in sync with what the user has seen
        try {
          const Notification = require('../models/Notification');
          const result = await Notification.updateMany(
            { userId: uid, type: 'chat', actorId: otherUserId, read: false },
            { $set: { read: true, readAt: new Date() } },
          );
          if (result.modifiedCount) {
            socket.emit('notification:sync', { reason: 'chat_read' });
          }
        } catch {
          /* badge sync is best-effort */
        }
      } catch (err) {
        console.error('chat:read error:', err);
      }
    });

    // ── Delete messages (WhatsApp-style) ──────────────
    // scope: "everyone" — only own messages, both sides
    // scope: "me" — hide from this user only
    socket.on('chat:delete', async ({ messageIds, scope: rawScope }) => {
      try {
        const ids = Array.isArray(messageIds)
          ? messageIds.filter((id) => String(id).match(/^[0-9a-f]{24}$/i))
          : [];
        if (!ids.length) return;

        const scope = rawScope === 'everyone' ? 'everyone' : 'me';
        const mongoose = require('mongoose');
        const myObjId = new mongoose.Types.ObjectId(uid);
        const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
        const now = new Date();

        if (scope === 'everyone') {
          const messages = await Message.find({
            _id: { $in: objectIds },
            senderId: myObjId,
            isDeleted: { $ne: true },
          });
          if (!messages.length) return;

          await Message.updateMany(
            { _id: { $in: messages.map((m) => m._id) } },
            {
              $set: {
                isDeleted: true,
                deletedAt: now,
                deletedBy: myObjId,
                text: '',
                mediaUrl: null,
              },
            },
          );

          const byRoom = new Map();
          for (const m of messages) {
            if (!byRoom.has(m.roomId)) byRoom.set(m.roomId, []);
            byRoom.get(m.roomId).push(String(m._id));
          }
          for (const [room, roomIds] of byRoom.entries()) {
            const payload = {
              messageIds: roomIds,
              scope: 'everyone',
              deletedBy: uid,
              deletedAt: now.toISOString(),
            };
            io.to(room).emit('chat:deleted', payload);
            for (const userId of String(room).split('_')) {
              const sockId = onlineUsers.get(userId);
              if (sockId) io.to(sockId).emit('chat:deleted', payload);
            }
          }
          return;
        }

        // Delete for me only
        const messages = await Message.find({
          _id: { $in: objectIds },
          $or: [{ senderId: myObjId }, { receiverId: myObjId }],
          deletedFor: { $nin: [myObjId] },
        });
        if (!messages.length) return;

        await Message.updateMany(
          { _id: { $in: messages.map((m) => m._id) } },
          { $addToSet: { deletedFor: myObjId } },
        );

        const deletedIds = messages.map((m) => String(m._id));
        const payload = {
          messageIds: deletedIds,
          scope: 'me',
          deletedBy: uid,
          deletedAt: now.toISOString(),
        };
        socket.emit('chat:deleted-for-me', payload);
        const sockId = onlineUsers.get(uid);
        if (sockId && sockId !== socket.id) {
          io.to(sockId).emit('chat:deleted-for-me', payload);
        }
        notifyUser(io, uid, 'chat:deleted-for-me', payload);
      } catch (err) {
        console.error('chat:delete error:', err);
        socket.emit('chat:error', { error: 'Failed to delete messages' });
      }
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', async () => {
      const set = onlineSockets.get(uid);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineSockets.delete(uid);
          onlineUsers.delete(uid);
        } else {
          setPrimarySocket(uid);
        }
      }

      const disc = await presence.socketDisconnected(uid);
      const becameOffline = redisReady()
        ? disc.becameOffline
        : !onlineSockets.has(uid);

      if (becameOffline) {
        await User.findByIdAndUpdate(uid, {
          isOnline: false,
          lastSeen: new Date(),
        });

        try {
          await calls.handleUserDisconnect(uid);
        } catch (err) {
          console.error('call disconnect cleanup:', err.message);
        }

        exploreMatchmaking.leaveQueue(uid);

        // Instant offline for everyone else
        socket.broadcast.emit('user:offline', {
          userId: uid,
          isOnline: false,
        });

        const chats = await getViewingSet(uid);
        chats.forEach((otherUserId) => {
          const room = String(
            [String(uid), String(otherUserId)].sort().join('_'),
          );
          io.to(room).emit('user:offline', {
            userId: uid,
            isOnline: false,
          });
        });
        await clearViewing(uid);
      }

      console.log(`❌ Socket disconnected: ${uid}`);
    });
  });

  return io;
};
