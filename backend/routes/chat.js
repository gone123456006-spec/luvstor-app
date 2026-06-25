const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const auth = require('../middleware/auth');

// Helper: generate a consistent room ID from two user IDs
function roomId(a, b) {
  return [a, b].sort().join('_');
}

// ─────────────────────────────────────────────
// GET /api/chat/history/:otherUserId
// Fetch last N messages between me and another user
// ─────────────────────────────────────────────
router.get('/history/:otherUserId', auth, async (req, res) => {
  try {
    const room = roomId(req.userId, req.params.otherUserId);
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before; // ISO date cursor for pagination

    const query = { roomId: room };
    if (before) query.createdAt = { $lt: new Date(before) };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Mark as read
    await Message.updateMany(
      { roomId: room, receiverId: req.userId, read: false },
      { read: true }
    );

    res.json(messages.reverse()); // oldest first
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
          $or: [{ senderId: myObjId }, { receiverId: myObjId }],
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
                { $and: [{ $eq: ['$read', false] }, { $eq: ['$receiverId', myObjId] }] },
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
    const User = require('../models/User');
    const enriched = await Promise.all(
      conversations.map(async (c) => {
        const msg = c.lastMessage;
        const otherId =
          String(msg.senderId) === req.userId ? msg.receiverId : msg.senderId;
        const other = await User.findById(otherId)
          .select('name photo gender isOnline lastSeen')
          .lean();
        return { ...c, otherUser: other || null };
      })
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
// ─────────────────────────────────────────────
router.post('/send', auth, async (req, res) => {
  try {
    const { receiverId, text, type = 'text', mediaUrl = null } = req.body;
    if (!receiverId || (!text && !mediaUrl)) {
      return res.status(400).json({ error: 'receiverId and text or mediaUrl are required' });
    }

    const room = roomId(req.userId, receiverId);
    const message = await Message.create({
      roomId: room,
      senderId: req.userId,
      receiverId,
      text: text || '',
      type,
      mediaUrl: mediaUrl || null,
    });

    // Also emit via Socket.IO so the other user gets it in real time if online
    const io = req.app.get('io');
    if (io) {
      io.to(room).emit('chat:message', {
        _id: message._id,
        roomId: room,
        senderId: req.userId,
        receiverId,
        text: message.text,
        type: message.type,
        mediaUrl: message.mediaUrl,
        read: message.read,
        createdAt: message.createdAt,
      });
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
    const room = roomId(req.userId, req.params.otherUserId);
    const after = req.query.after ? new Date(req.query.after) : new Date(0);

    const messages = await Message.find({
      roomId: room,
      createdAt: { $gt: after },
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    // Mark incoming messages as read
    await Message.updateMany(
      { roomId: room, receiverId: req.userId, read: false },
      { read: true }
    );

    res.json(messages);
  } catch (err) {
    console.error('chat/poll error:', err);
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
    });
    res.json({ unread: count });
  } catch (err) {
    console.error('chat/unread-count error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.roomId = roomId;

