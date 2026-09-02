const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Friendship = require('../models/Friendship');
const auth = require('../middleware/auth');
const { 
  ensureChatSession, 
  canSendMessage, 
  incrementMessageCount, 
  resetMessageCount,
  getConversationRestrictions,
} = require('../services/chatTokens');
const { getBlockState } = require('../utils/blockState');
const { applyBlockPrivacy } = require('../utils/blockPrivacy');

// Helper: Check if two users are friends
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

async function ensureConversationState(userId, otherUserId) {
  const ConversationState = require('../models/ConversationState');
  const room = roomId(userId, otherUserId);
  return ConversationState.findOneAndUpdate(
    { userId, otherUserId },
    {
      $setOnInsert: {
        roomId: room,
        consecutiveMessages: 0,
        waitingForReply: false,
      },
    },
    { upsert: true, new: true },
  );
}

async function getConversationVisibility(userId) {
  const ConversationState = require('../models/ConversationState');
  const states = await ConversationState.find({ userId })
    .select('otherUserId archived clearedAt')
    .lean();
  const archived = new Set();
  const cleared = new Set();
  for (const s of states) {
    const oid = String(s.otherUserId);
    if (s.clearedAt) cleared.add(oid);
    else if (s.archived) archived.add(oid);
  }
  return { archived, cleared };
}

/** New message restores deleted/archived chat for the recipient (WhatsApp-style). */
async function reopenConversationForReceiver(receiverId, senderId) {
  const ConversationState = require('../models/ConversationState');
  const room = roomId(receiverId, senderId);
  await ConversationState.updateOne(
    { userId: receiverId, otherUserId: senderId },
    {
      $set: {
        clearedAt: null,
        archived: false,
        archivedAt: null,
        roomId: room,
      },
    },
  );
}

async function enrichConversationRow(reqUserId, c) {
  const User = require('../models/User');
  const msg = c.lastMessage;
  const otherId =
    String(msg.senderId) === reqUserId ? msg.receiverId : msg.senderId;
  const other = await User.findById(otherId)
    .select('name bio photo gender isOnline lastSeen')
    .lean();

  const safeOther = await applyBlockPrivacy(reqUserId, other);

  const friendsStatus = await areFriends(reqUserId, otherId);
  const { userA, userB } = Friendship.getSortedPair(reqUserId, otherId);
  const friendship = await Friendship.findOne({ userA, userB }).lean();

  let category = 'stranger';
  if (friendsStatus) {
    category = 'friend';
  } else if (
    friendship &&
    (friendship.status === 'mutual_match' ||
      (friendship.status === 'pending_like' &&
        String(friendship.initiatedBy) !== reqUserId))
  ) {
    category = 'request';
  }

  const iLiked =
    friendsStatus ||
    friendship?.status === 'mutual_match' ||
    (friendship?.status === 'pending_like' &&
      String(friendship.initiatedBy) === reqUserId);

  const block = await getBlockState(reqUserId, otherId);
  const otherForClient = safeOther
    ? {
        ...safeOther,
        isOnline: block.blocked ? false : !!safeOther.isOnline,
        lastSeen: block.blocked ? null : safeOther.lastSeen,
      }
    : null;

  return {
    ...c,
    otherUser: otherForClient,
    category: block.blocked ? 'stranger' : category,
    friendshipStatus: friendship?.status || 'none',
    areFriends: friendsStatus && !block.blocked,
    iLiked: !!iLiked && !block.blocked,
    iBlocked: block.iBlocked,
    theyBlocked: block.theyBlocked,
    privacyHidden: !!safeOther?.privacyHidden,
    blockedAt: block.blockedAt,
    canCall: friendsStatus && !block.blocked,
  };
}

/** Redact view-once media for the viewer (WhatsApp-style). */
function shapeViewOnceForViewer(msg, viewerId) {
  if (!msg) return msg;
  let out = msg;
  if (msg.viewOnce) {
    out = { ...msg };
    const isSender = String(msg.senderId) === String(viewerId);
    if (msg.viewOnceOpened) {
      out.mediaUrl = null;
    } else if (!isSender) {
      out.mediaUrl = null;
    }
  }
  // Nested reply quotes must never leak view-once media
  if (out.replyTo && typeof out.replyTo === 'object') {
    out = {
      ...out,
      replyTo: shapeReplyToSnapshot(out.replyTo),
    };
  }
  return out;
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

// ─────────────────────────────────────────────
// GET /api/chat/history/:otherUserId
// Fetch last N messages between me and another user
// Ownership: only the two parties in the room can access
// ─────────────────────────────────────────────
router.get('/history/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;

    // Validation: other user must be a valid ID
    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    // Validation: cannot message yourself
    if (otherUserId === req.userId.toString()) {
      return res.status(400).json({ error: 'Cannot fetch conversation with yourself' });
    }

    const room = roomId(req.userId, otherUserId);
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before; // ISO date cursor for pagination

    // Hide undelivered messages from the blocked recipient
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);
    const query = {
      roomId: room,
      deletedFor: { $nin: [myObjId] },
      $or: [
        { undelivered: { $ne: true } },
        { senderId: myObjId },
      ],
    };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate({
        path: 'replyTo',
        select: REPLY_TO_SELECT,
      })
      .lean();

    // Mark as read + notify sender for blue ticks
    const now = new Date();
    const unread = await Message.find({
      roomId: room,
      receiverId: myObjId,
      read: false,
      undelivered: { $ne: true },
      deletedFor: { $nin: [myObjId] },
    })
      .select('_id senderId')
      .lean();

    if (unread.length) {
      const messageIds = unread.map((m) => String(m._id));
      await Message.updateMany(
        { _id: { $in: unread.map((m) => m._id) } },
        {
          $set: {
            read: true,
            readAt: now,
            delivered: true,
            deliveredAt: now,
          },
        },
      );

      const io = req.app.get('io');
      if (io) {
        const { notifyUser } = require('../utils/realtime');
        const payload = {
          by: String(req.userId),
          messageIds,
          roomId: room,
        };
        io.to(room).emit('chat:read', payload);
        const senders = new Set(unread.map((m) => String(m.senderId)));
        for (const sid of senders) {
          if (sid !== String(req.userId)) notifyUser(io, sid, 'chat:read', payload);
        }
      }
    }

    res.json(messages.reverse().map((m) => shapeViewOnceForViewer(m, req.userId))); // oldest first
  } catch (err) {
    console.error('chat/history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/conversations
// Get list of all conversations (last message per room)
// ─────────────────────────────────────────────
router.get('/conversations', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    const conversations = await Message.aggregate([
      {
        $match: {
          isDeleted: { $ne: true },
          deletedFor: { $nin: [myObjId] },
          $and: [
            { $or: [{ senderId: myObjId }, { receiverId: myObjId }] },
            // Undelivered (blocked) messages are only visible to the sender
            {
              $or: [
                { undelivered: { $ne: true } },
                { senderId: myObjId },
              ],
            },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$roomId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$read', false] },
                    { $eq: ['$receiverId', myObjId] },
                    { $ne: ['$undelivered', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          // Used to classify Friend vs Request
          sentByMe: {
            $sum: {
              $cond: [{ $eq: ['$senderId', myObjId] }, 1, 0],
            },
          },
          receivedByMe: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', myObjId] },
                    { $ne: ['$undelivered', true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
    ]);

    // Populate the other user's profile for each conversation
    const { archived: archivedIds, cleared: clearedIds } =
      await getConversationVisibility(req.userId);

    const visible = conversations.filter((c) => {
      const msg = c.lastMessage;
      const otherId =
        String(msg.senderId) === req.userId
          ? String(msg.receiverId)
          : String(msg.senderId);
      return !archivedIds.has(otherId) && !clearedIds.has(otherId);
    });

    const enriched = await Promise.all(
      visible.map((c) => enrichConversationRow(req.userId, c)),
    );

    res.json(enriched);
  } catch (err) {
    console.error('conversations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/send
// Send a message via REST (used when socket client unavailable)
// Ownership: sender must be authenticated user
// ─────────────────────────────────────────────
router.post('/send', auth, async (req, res) => {
  try {
    const { receiverId, text, type = 'text', mediaUrl = null, replyTo = null, viewOnce = false } = req.body;

    if (!receiverId || (!text && !mediaUrl)) {
      return res.status(400).json({ error: 'receiverId and text or mediaUrl are required' });
    }

    // Validation: receiver must be a valid ID
    if (!receiverId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid receiverId' });
    }

    // Validation: cannot message yourself
    if (receiverId === req.userId.toString()) {
      return res.status(400).json({ error: 'Cannot send message to yourself' });
    }

    const block = await getBlockState(req.userId, receiverId);
    if (block.iBlocked) {
      return res.status(403).json({
        error: 'Unblock this person to send messages',
        code: 'BLOCKED',
      });
    }
    // Receiver blocked the sender → keep message for sender only (WhatsApp)
    const receiverView = await getBlockState(receiverId, req.userId);
    const undelivered = !!block.theyBlocked || !!receiverView.iBlocked;

    // Token session gate (independent of other monetization)
    const access = await ensureChatSession(req.userId);
    if (!access.ok) {
      return res.status(402).json(access);
    }

    // Check friendship status for non-text messages (Friends & Match feature)
    if (type !== 'text') {
      if (undelivered) {
        return res.status(403).json({
          error: 'Only text messages can be sent while blocked.',
          code: 'BLOCKED_MEDIA',
        });
      }
      const friendsStatus = await areFriends(req.userId, receiverId);
      if (!friendsStatus) {
        return res.status(403).json({
          error: 'Only friends can send images, voice messages, and files. Send a like and become friends first!',
          code: 'NOT_FRIENDS',
          requiresFriendship: true,
        });
      }
    }

    // Check message limits (skip while undelivered — local-only sends)
    if (!undelivered) {
      const canSend = await canSendMessage(req.userId, receiverId, type);
      if (!canSend.ok) {
        return res.status(403).json({
          error: canSend.message,
          code: canSend.code,
          consecutiveCount: canSend.consecutiveCount,
        });
      }
    }

    const room = roomId(req.userId, receiverId);
    const io = req.app.get('io');
    const onlineUsers = io?.onlineUsers;
    const receiverOnline =
      !undelivered &&
      onlineUsers instanceof Map &&
      onlineUsers.has(String(receiverId));
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
    const message = await Message.create({
      roomId: room,
      senderId: req.userId,
      receiverId,
      text: text || '',
      type,
      mediaUrl: mediaUrl || null,
      undelivered,
      delivered: !!receiverOnline,
      deliveredAt: receiverOnline ? now : null,
      read: false,
      replyTo: replyToId,
      viewOnce: isViewOnce,
      viewOnceOpened: false,
    });

    if (!undelivered) {
      await incrementMessageCount(req.userId, receiverId);
      await resetMessageCount(req.userId, receiverId);
      await reopenConversationForReceiver(receiverId, req.userId);
    }

    // Also emit via Socket.IO so the other user gets it in real time if online
    if (io) {
      const payload = {
        _id: message._id,
        roomId: room,
        senderId: req.userId,
        receiverId,
        text: message.text,
        type: message.type,
        mediaUrl: message.mediaUrl,
        delivered: !!message.delivered,
        read: !!message.read,
        undelivered: !!message.undelivered,
        createdAt: message.createdAt,
        replyTo: replyToPayload,
        viewOnce: !!message.viewOnce,
        viewOnceOpened: !!message.viewOnceOpened,
      };
      const receiverPayload = message.viewOnce
        ? { ...payload, mediaUrl: null }
        : payload;

      const { notifyUser, actorPayload } = require('../utils/realtime');
      notifyUser(io, req.userId, 'chat:message', payload);

      if (!undelivered) {
        const User = require('../models/User');
        const { createNotification } = require('../services/notifications');
        io.to(room).emit('chat:message', receiverPayload);
        const actor = await actorPayload(User, req.userId);
        notifyUser(io, receiverId, 'chat:message', receiverPayload);
        if (message.delivered) {
          notifyUser(io, req.userId, 'chat:delivered', {
            by: String(receiverId),
            messageIds: [String(message._id)],
          });
        }
        notifyUser(io, receiverId, 'chat:notification', {
          from: req.userId,
          roomId: room,
          text: message.text,
          type: message.type,
          fromName: actor.fromName,
          fromPhoto: actor.fromPhoto,
          fromGender: actor.fromGender,
        });
        const preview =
          message.type === 'image'
            ? '📷 Photo'
            : message.type === 'audio'
              ? '🎵 Voice message'
              : message.text || 'New message';
        await createNotification(io, {
          userId: receiverId,
          type: 'chat',
          title: 'New message',
          body: preview,
          actorId: req.userId,
          groupKey: `chat:${room}`,
          deepLink: `/messages/${req.userId}`,
          data: {
            screen: 'messages',
            userId: String(req.userId),
            roomId: room,
          },
        });
      }
    }

    res.json(message);
  } catch (err) {
    console.error('chat/send error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/poll/:otherUserId?after=<ISO>
// Poll for new messages since a given timestamp
// ─────────────────────────────────────────────
router.get('/poll/:otherUserId', auth, async (req, res) => {
  try {
    const otherUserId = req.params.otherUserId;
    if (!otherUserId || otherUserId === req.userId.toString()) {
      return res.status(400).json({ error: 'Invalid user' });
    }

    const room = roomId(req.userId, otherUserId);
    const after = req.query.after ? new Date(req.query.after) : new Date(0);
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    // WhatsApp-like: undelivered (blocked) messages are sender-only
    const messages = await Message.find({
      roomId: room,
      createdAt: { $gt: after },
      deletedFor: { $nin: [myObjId] },
      $or: [
        { undelivered: { $ne: true } },
        { senderId: myObjId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .populate({
        path: 'replyTo',
        select: REPLY_TO_SELECT,
      })
      .lean();

    // Mark incoming messages as read + notify sender for blue ticks
    const now = new Date();
    const unread = await Message.find({
      roomId: room,
      receiverId: myObjId,
      read: false,
      undelivered: { $ne: true },
      deletedFor: { $nin: [myObjId] },
    })
      .select('_id senderId')
      .lean();

    if (unread.length) {
      const messageIds = unread.map((m) => String(m._id));
      await Message.updateMany(
        { _id: { $in: unread.map((m) => m._id) } },
        {
          $set: {
            read: true,
            readAt: now,
            delivered: true,
            deliveredAt: now,
          },
        },
      );

      const io = req.app.get('io');
      if (io) {
        const { notifyUser } = require('../utils/realtime');
        const payload = {
          by: String(req.userId),
          messageIds,
          roomId: room,
        };
        io.to(room).emit('chat:read', payload);
        const senders = new Set(unread.map((m) => String(m.senderId)));
        for (const sid of senders) {
          if (sid !== String(req.userId)) notifyUser(io, sid, 'chat:read', payload);
        }
      }
    }

    res.json(messages.map((m) => shapeViewOnceForViewer(m, req.userId)));
  } catch (err) {
    console.error('chat/poll error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/view-once/:messageId
// Receiver opens a view-once photo (one time)
// ─────────────────────────────────────────────
router.post('/view-once/:messageId', auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    if (!messageId || !String(messageId).match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid messageId' });
    }

    const message = await Message.findById(messageId);
    if (!message || !message.viewOnce || message.type !== 'image') {
      return res.status(404).json({ error: 'View-once photo not found' });
    }
    if (String(message.receiverId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Only the recipient can open this photo' });
    }
    if (message.viewOnceOpened) {
      return res.status(410).json({
        error: 'Already opened',
        code: 'ALREADY_OPENED',
        viewOnceOpened: true,
        mediaUrl: null,
      });
    }

    message.viewOnceOpened = true;
    message.viewOnceOpenedAt = new Date();
    await message.save();

    const io = req.app.get('io');
    if (io) {
      const { notifyUser } = require('../utils/realtime');
      const openedPayload = {
        messageId: String(message._id),
        viewOnceOpened: true,
        by: String(req.userId),
      };
      io.to(message.roomId).emit('chat:view-once-opened', openedPayload);
      notifyUser(io, message.senderId, 'chat:view-once-opened', openedPayload);
    }

    res.json({
      messageId: String(message._id),
      mediaUrl: message.mediaUrl || null,
      viewOnceOpened: true,
    });
  } catch (err) {
    console.error('view-once open error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/delete
// WhatsApp-style:
//   scope: "everyone" — only YOUR messages; soft-delete for both
//   scope: "me"       — hide from your chat only (any message)
// Body: { messageIds: string[], scope?: "me" | "everyone" }
// ─────────────────────────────────────────────
router.post('/delete', auth, async (req, res) => {
  try {
    const messageIds = Array.isArray(req.body.messageIds) ? req.body.messageIds : [];
    const scope = req.body.scope === 'everyone' ? 'everyone' : 'me';
    if (!messageIds.length) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }

    const validIds = messageIds.filter((id) => String(id).match(/^[0-9a-f]{24}$/i));
    if (!validIds.length) {
      return res.status(400).json({ error: 'No valid message IDs' });
    }

    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);
    const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
    const now = new Date();

    if (scope === 'everyone') {
      // Only the sender can delete their own messages for everyone
      const messages = await Message.find({
        _id: { $in: objectIds },
        senderId: myObjId,
        isDeleted: { $ne: true },
      });

      if (!messages.length) {
        return res.json({
          success: true,
          scope,
          deletedIds: [],
          message: 'No messages to delete for everyone',
        });
      }

      const deletedIds = messages.map((m) => String(m._id));

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

      const io = req.app.get('io');
      if (io) {
        const byRoom = new Map();
        for (const m of messages) {
          if (!byRoom.has(m.roomId)) byRoom.set(m.roomId, []);
          byRoom.get(m.roomId).push(String(m._id));
        }

        for (const [room, ids] of byRoom.entries()) {
          const payload = {
            messageIds: ids,
            scope: 'everyone',
            deletedBy: String(req.userId),
            deletedAt: now.toISOString(),
          };
          io.to(room).emit('chat:deleted', payload);

          const onlineUsers = io.onlineUsers;
          if (onlineUsers instanceof Map) {
            for (const uid of String(room).split('_')) {
              const sockId = onlineUsers.get(uid);
              if (sockId) io.to(sockId).emit('chat:deleted', payload);
            }
          }
        }
      }

      return res.json({ success: true, scope, deletedIds });
    }

    // Delete for me — hide from this user only (own or others' messages)
    const messages = await Message.find({
      _id: { $in: objectIds },
      $or: [{ senderId: myObjId }, { receiverId: myObjId }],
      deletedFor: { $nin: [myObjId] },
    });

    if (!messages.length) {
      return res.json({
        success: true,
        scope: 'me',
        deletedIds: [],
        message: 'No messages to delete',
      });
    }

    const deletedIds = messages.map((m) => String(m._id));

    await Message.updateMany(
      { _id: { $in: messages.map((m) => m._id) } },
      { $addToSet: { deletedFor: myObjId } },
    );

    // Notify only this user's devices (not the other person)
    const io = req.app.get('io');
    if (io) {
      const payload = {
        messageIds: deletedIds,
        scope: 'me',
        deletedBy: String(req.userId),
        deletedAt: now.toISOString(),
      };
      const { notifyUser } = require('../utils/realtime');
      notifyUser(io, String(req.userId), 'chat:deleted-for-me', payload);
      // Also emit on joined rooms for this socket session if present
      io.to(String(req.userId)).emit('chat:deleted-for-me', payload);
    }

    res.json({ success: true, scope: 'me', deletedIds });
  } catch (err) {
    console.error('chat/delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/unread-count
// Global unread message count
// ─────────────────────────────────────────────
router.get('/unread-count', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);
    const count = await Message.countDocuments({
      receiverId: myObjId,
      read: false,
      isDeleted: { $ne: true },
      undelivered: { $ne: true },
      deletedFor: { $nin: [myObjId] },
    });
    res.json({ unread: count });
  } catch (err) {
    console.error('chat/unread-count error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/restrictions
// Get conversation restrictions and blocked conversations
// ─────────────────────────────────────────────
router.get('/restrictions', auth, async (req, res) => {
  try {
    const restrictions = await getConversationRestrictions(req.userId);
    res.json(restrictions);
  } catch (err) {
    console.error('chat/restrictions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/conversation-status/:otherUserId
// Get status for a specific conversation (message count, blocked state)
// ─────────────────────────────────────────────
router.get('/conversation-status/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;

    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    const ConversationState = require('../models/ConversationState');
    const canSend = await canSendMessage(req.userId, otherUserId, 'text');
    const state = await ConversationState.findOne({
      userId: req.userId,
      otherUserId,
    })
      .select('muted mutedAt consecutiveMessages')
      .lean();

    res.json({
      canSend: canSend.ok,
      code: canSend.code,
      message: canSend.message,
      consecutiveCount: canSend.consecutiveCount || state?.consecutiveMessages || 0,
      muted: !!state?.muted,
      mutedAt: state?.mutedAt || null,
    });
  } catch (err) {
    console.error('chat/conversation-status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/mute/:otherUserId  { muted: boolean }
// WhatsApp-style mute for this conversation only
// ─────────────────────────────────────────────
router.post('/mute/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const muted = !!req.body?.muted;

    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    const ConversationState = require('../models/ConversationState');
    const room = roomId(req.userId, otherUserId);
    const state = await ConversationState.findOneAndUpdate(
      { userId: req.userId, otherUserId },
      {
        $set: {
          muted,
          mutedAt: muted ? new Date() : null,
          roomId: room,
        },
        $setOnInsert: {
          consecutiveMessages: 0,
          waitingForReply: false,
        },
      },
      { upsert: true, new: true },
    );

    res.json({ ok: true, muted: !!state.muted, mutedAt: state.mutedAt });
  } catch (err) {
    console.error('chat/mute error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/chat/archived
// Archived conversations (WhatsApp-style)
// ─────────────────────────────────────────────
router.get('/archived', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const ConversationState = require('../models/ConversationState');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    const archivedStates = await ConversationState.find({
      userId: req.userId,
      archived: true,
      clearedAt: null,
    })
      .sort({ archivedAt: -1 })
      .lean();

    if (!archivedStates.length) {
      return res.json([]);
    }

    const rows = await Promise.all(
      archivedStates.map(async (state) => {
        const otherUserId = String(state.otherUserId);
        const room = roomId(req.userId, otherUserId);
        const lastMessage = await Message.findOne({
          roomId: room,
          isDeleted: { $ne: true },
          deletedFor: { $nin: [myObjId] },
          $or: [
            { undelivered: { $ne: true } },
            { senderId: myObjId },
          ],
        })
          .sort({ createdAt: -1 })
          .lean();

        if (!lastMessage) {
          const User = require('../models/User');
          const other = await User.findById(otherUserId)
            .select('name photo gender isOnline lastSeen')
            .lean();
          const safeOther = await applyBlockPrivacy(req.userId, other);
          const block = await getBlockState(req.userId, otherUserId);
          return {
            _id: room,
            lastMessage: {
              _id: `archived_${otherUserId}`,
              senderId: myObjId,
              receiverId: otherUserId,
              text: 'Archived chat',
              type: 'text',
              createdAt: state.archivedAt || state.updatedAt,
            },
            unreadCount: 0,
            otherUser: safeOther
              ? {
                  ...safeOther,
                  isOnline: block.blocked ? false : !!safeOther.isOnline,
                }
              : null,
            archivedAt: state.archivedAt,
          };
        }

        const enriched = await enrichConversationRow(req.userId, {
          _id: room,
          lastMessage,
          unreadCount: 0,
        });
        return { ...enriched, archivedAt: state.archivedAt };
      }),
    );

    res.json(rows.filter(Boolean));
  } catch (err) {
    console.error('chat/archived error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/archive/:otherUserId
// ─────────────────────────────────────────────
router.post('/archive/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }
    if (otherUserId === req.userId) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    const state = await ensureConversationState(req.userId, otherUserId);
    state.archived = true;
    state.archivedAt = new Date();
    state.clearedAt = null;
    await state.save();

    res.json({ success: true, archived: true, archivedAt: state.archivedAt });
  } catch (err) {
    console.error('chat/archive error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/chat/unarchive/:otherUserId
// ─────────────────────────────────────────────
router.post('/unarchive/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    const ConversationState = require('../models/ConversationState');
    await ConversationState.findOneAndUpdate(
      { userId: req.userId, otherUserId },
      { archived: false, archivedAt: null },
    );

    res.json({ success: true, archived: false });
  } catch (err) {
    console.error('chat/unarchive error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/chat/conversation/:otherUserId
// Permanently delete chat + remove friendship
// ─────────────────────────────────────────────
router.delete('/conversation/:otherUserId', auth, async (req, res) => {
  try {
    const { otherUserId } = req.params;
    if (!otherUserId || !otherUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }
    if (otherUserId === req.userId) {
      return res.status(400).json({ error: 'Invalid otherUserId' });
    }

    const mongoose = require('mongoose');
    const ConversationState = require('../models/ConversationState');
    const User = require('../models/User');
    const myObjId = new mongoose.Types.ObjectId(req.userId);
    const room = roomId(req.userId, otherUserId);

    await Message.updateMany(
      {
        roomId: room,
        $or: [{ senderId: myObjId }, { receiverId: myObjId }],
        deletedFor: { $nin: [myObjId] },
      },
      { $addToSet: { deletedFor: myObjId } },
    );

    const { userA, userB } = Friendship.getSortedPair(req.userId, otherUserId);
    await Friendship.deleteOne({ userA, userB });

    await ConversationState.findOneAndUpdate(
      { userId: req.userId, otherUserId },
      {
        archived: false,
        archivedAt: null,
        clearedAt: new Date(),
        roomId: room,
      },
      { upsert: true },
    );

    const io = req.app.get('io');
    if (io) {
      const { emitFriendUpdate, emitFriendSync, notifyUser } = require('../utils/realtime');
      await emitFriendUpdate(io, User, otherUserId, req.userId, 'unlike', 'stranger');
      await emitFriendSync(io, User, req.userId, otherUserId, 'stranger');
      notifyUser(io, req.userId, 'conversation:deleted', {
        otherUserId: String(otherUserId),
      });
    }

    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('chat/conversation delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.roomId = roomId;

