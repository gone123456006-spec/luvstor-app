const express = require('express');
const router = express.Router();
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { emitFriendUpdate, emitFriendSync } = require('../utils/realtime');
const { createNotification } = require('../services/notifications');

// ─────────────────────────────────────────────
// POST /api/friends/like
// Send a like to another user
// ─────────────────────────────────────────────
router.post('/like', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    // Can't like yourself
    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot like yourself' });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get sorted pair for consistent storage
    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);

    // Check if friendship already exists
    let friendship = await Friendship.findOne({ userA, userB });

    if (friendship) {
      // Already friends or pending
      if (friendship.status === 'friends') {
        return res.json({ 
          message: 'Already friends', 
          status: 'friends',
          friendship 
        });
      }
      
      if (friendship.status === 'mutual_match') {
        return res.json({ 
          message: 'Mutual match already exists', 
          status: 'mutual_match',
          friendship 
        });
      }

      // If pending_like, check if this user already liked
      if (friendship.status === 'pending_like') {
        // Check if current user is the one who initiated
        if (String(friendship.initiatedBy) === req.userId) {
          return res.json({ 
            message: 'You already liked this user', 
            status: 'pending_like',
            friendship 
          });
        } else {
          // Like-back completes the mutual decision and creates the friendship.
          // The first like is the sender's approval; this like is the recipient's.
          friendship.status = 'friends';
          friendship.matchedAt = new Date();
          friendship.friendsSince = new Date();
          friendship.acceptedBy = [friendship.initiatedBy, req.userId];
          await friendship.save();

          const io = req.app.get('io');
          await emitFriendUpdate(io, User, targetUserId, req.userId, 'friends', 'friends');
          await emitFriendSync(io, User, req.userId, targetUserId, 'friends');
          // Mutual like → it's a match for both sides
          await createNotification(io, {
            userId: targetUserId,
            type: 'match',
            title: "It's a match!",
            body: 'You liked each other. Start chatting now!',
            actorId: req.userId,
            deepLink: `/messages/${req.userId}`,
            data: { screen: 'messages', userId: String(req.userId) },
          });
          await createNotification(io, {
            userId: req.userId,
            type: 'match',
            title: "It's a match!",
            body: 'You liked each other. Start chatting now!',
            actorId: targetUserId,
            deepLink: `/messages/${targetUserId}`,
            data: { screen: 'messages', userId: String(targetUserId) },
          });
          
          return res.json({ 
            message: 'You are now friends!', 
            status: 'friends',
            friendship 
          });
        }
      }

      // If declined or blocked, don't allow new like
      if (friendship.status === 'declined' || friendship.status === 'blocked') {
        return res.status(403).json({ 
          error: 'Cannot like this user', 
          status: friendship.status 
        });
      }
    }

    // Create new friendship with pending_like status
    friendship = await Friendship.create({
      userA,
      userB,
      status: 'pending_like',
      initiatedBy: req.userId,
      likedAt: new Date(),
    });

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'like', 'pending_like');
    await emitFriendSync(io, User, req.userId, targetUserId, 'pending_like');
    await createNotification(io, {
      userId: targetUserId,
      type: 'friend_request',
      title: 'New friend request',
      body: 'Someone liked you. Open Requests to respond.',
      actorId: req.userId,
      data: { screen: 'chat', filter: 'Request', userId: String(req.userId) },
    });

    res.json({ 
      message: 'Like sent successfully', 
      status: 'pending_like',
      friendship 
    });
  } catch (err) {
    console.error('friends/like error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/friends/requests
// Get incoming likes and mutual matches (friend requests)
// ─────────────────────────────────────────────
router.get('/requests', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    // Incoming one-way likes and any legacy mutual matches belong in Requests.
    // Outgoing likes are intentionally omitted.
    const matches = await Friendship.find({
      $and: [
        { $or: [{ userA: myObjId }, { userB: myObjId }] },
        {
          $or: [
            { status: 'mutual_match' },
            {
              status: 'pending_like',
              initiatedBy: { $ne: myObjId },
            },
          ],
        },
      ],
    }).sort({ updatedAt: -1 }).lean();

    // Populate the other user's info
    const enriched = await Promise.all(
      matches.map(async (m) => {
        const otherId = String(m.userA) === req.userId ? m.userB : m.userA;
        const other = await User.findById(otherId)
          .select('name photo gender age bio isOnline lastSeen')
          .lean();
        return {
          ...m,
          otherUser: other || null,
          otherId: String(otherId),
          requestType: m.status === 'pending_like' ? 'incoming_like' : 'mutual_match',
          acceptedByMe: (m.acceptedBy || []).some((id) => String(id) === req.userId),
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('friends/requests error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/accept
// Accept a mutual friend request (mutual match -> friends)
// ─────────────────────────────────────────────
router.post('/accept', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);

    const friendship = await Friendship.findOne({ userA, userB });

    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    if (friendship.status !== 'mutual_match') {
      return res.status(400).json({ 
        error: 'Can only accept mutual matches', 
        status: friendship.status 
      });
    }

    // A mutual match already contains consent from both likes. Accepting it
    // completes the request and moves it to Friends immediately.
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);
    if (!friendship.acceptedBy.some(id => id.equals(myObjId))) {
      friendship.acceptedBy.push(myObjId);
    }

    friendship.status = 'friends';
    friendship.friendsSince = new Date();

    await friendship.save();

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'friends', 'friends');
    await emitFriendSync(io, User, req.userId, targetUserId, 'friends');
    await createNotification(io, {
      userId: targetUserId,
      type: 'friends',
      title: "You're friends!",
      body: 'Your friend request was accepted.',
      actorId: req.userId,
      deepLink: `/messages/${req.userId}`,
      data: { screen: 'messages', userId: String(req.userId) },
    });

    res.json({ 
      message: 'You are now friends!',
      status: friendship.status,
      friendship 
    });
  } catch (err) {
    console.error('friends/accept error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/decline
// Decline a friend request
// ─────────────────────────────────────────────
router.post('/decline', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);

    const friendship = await Friendship.findOne({ userA, userB });

    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    if (friendship.status !== 'mutual_match' && friendship.status !== 'pending_like') {
      return res.status(400).json({ 
        error: 'Can only decline pending requests or matches', 
        status: friendship.status 
      });
    }

    friendship.status = 'declined';
    friendship.declinedAt = new Date();
    await friendship.save();

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'decline', 'declined');
    await emitFriendSync(io, User, req.userId, targetUserId, 'declined');

    res.json({ 
      message: 'Friend request declined',
      status: 'declined',
      friendship 
    });
  } catch (err) {
    console.error('friends/decline error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/friends/list
// Get list of friends
// ─────────────────────────────────────────────
router.get('/list', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    // Find all friendships where I'm either userA or userB and status is friends
    const friendships = await Friendship.find({
      $or: [
        { userA: myObjId, status: 'friends' },
        { userB: myObjId, status: 'friends' },
      ],
    }).lean();

    // Populate the other user's info
    const enriched = await Promise.all(
      friendships.map(async (f) => {
        const otherId = String(f.userA) === req.userId ? f.userB : f.userA;
        const other = await User.findById(otherId)
          .select('name photo gender age bio isOnline lastSeen')
          .lean();
        return {
          ...f,
          otherUser: other || null,
          otherId: String(otherId),
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('friends/list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/friends/likes
// Outgoing one-way likes I sent (pending_like initiated by me)
// ─────────────────────────────────────────────
router.get('/likes', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    const likes = await Friendship.find({
      status: 'pending_like',
      initiatedBy: myObjId,
      $or: [{ userA: myObjId }, { userB: myObjId }],
    })
      .sort({ likedAt: -1, updatedAt: -1 })
      .lean();

    const enriched = await Promise.all(
      likes.map(async (m) => {
        const otherId = String(m.userA) === req.userId ? m.userB : m.userA;
        const other = await User.findById(otherId)
          .select('name photo gender age bio isOnline lastSeen')
          .lean();
        return {
          ...m,
          otherUser: other || null,
          otherId: String(otherId),
          requestType: 'outgoing_like',
          iLiked: true,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error('friends/likes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/friends/blocked
// Users the current account has blocked
// ─────────────────────────────────────────────
router.get('/blocked', auth, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const myObjId = new mongoose.Types.ObjectId(req.userId);

    const rows = await Friendship.find({
      status: 'blocked',
      blockedBy: myObjId,
      $or: [{ userA: myObjId }, { userB: myObjId }],
    })
      .sort({ blockedAt: -1 })
      .lean();

    const blocked = await Promise.all(
      rows.map(async (f) => {
        const otherId = String(f.userA) === req.userId ? f.userB : f.userA;
        const other = await User.findById(otherId)
          .select('name photo gender age bio publicId isOnline')
          .lean();
        return {
          _id: String(f._id),
          otherId: String(otherId),
          blockedAt: f.blockedAt || f.updatedAt,
          otherUser: other
            ? {
                id: String(other._id),
                name: other.name || '',
                photo: other.photo || '',
                gender: other.gender || '',
                age: other.age ?? null,
                bio: other.bio || '',
                publicId: other.publicId || '',
                isOnline: !!other.isOnline,
              }
            : {
                id: String(otherId),
                name: 'Deleted user',
                photo: '',
                gender: '',
                age: null,
                bio: '',
                publicId: '',
                isOnline: false,
              },
        };
      }),
    );

    res.json({ blocked });
  } catch (err) {
    console.error('friends/blocked error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// GET /api/friends/status/:userId
// Check friendship status with a specific user
// ─────────────────────────────────────────────
router.get('/status/:userId', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    if (targetUserId === req.userId) {
      return res.json({ status: 'self', areFriends: false });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);

    const friendship = await Friendship.findOne({ userA, userB }).lean();

    if (!friendship) {
      return res.json({ 
        status: 'stranger', 
        areFriends: false,
        canSendMedia: false,
        canCall: false,
        iLiked: false,
        theyLiked: false,
      });
    }

    const matched =
      friendship.status === 'friends' || friendship.status === 'mutual_match';
    const iLiked =
      matched || String(friendship.initiatedBy) === req.userId;
    const theyLiked =
      matched || String(friendship.initiatedBy) === targetUserId;

    res.json({ 
      status: friendship.status,
      areFriends: matched,
      canSendMedia: matched,
      canCall: matched,
      iLiked,
      theyLiked,
      iBlocked: friendship.status === 'blocked' && String(friendship.blockedBy) === req.userId,
      theyBlocked: friendship.status === 'blocked' && String(friendship.blockedBy) === targetUserId,
      blockedAt: friendship.status === 'blocked' ? (friendship.blockedAt || friendship.updatedAt || null) : null,
      privacyHidden: friendship.status === 'blocked' && String(friendship.blockedBy) === targetUserId,
      friendship,
    });
  } catch (err) {
    console.error('friends/status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/unlike
// Undo a like / remove friendship
// - pending_like you sent → remove request
// - friends / mutual_match → remove relationship
// ─────────────────────────────────────────────
router.post('/unlike', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot unlike yourself' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);
    const friendship = await Friendship.findOne({ userA, userB });

    if (!friendship) {
      return res.json({
        message: 'No like to remove',
        status: 'stranger',
      });
    }

    if (friendship.status === 'blocked') {
      return res.status(403).json({
        error: 'Cannot unlike a blocked relationship',
        status: 'blocked',
      });
    }

    // One-way like: only the sender can remove their own like
    if (friendship.status === 'pending_like') {
      if (String(friendship.initiatedBy) !== req.userId) {
        return res.status(403).json({
          error: 'You have not liked this user',
          status: 'pending_like',
        });
      }
      await Friendship.deleteOne({ _id: friendship._id });
      const io = req.app.get('io');
      await emitFriendUpdate(io, User, targetUserId, req.userId, 'unlike', 'stranger');
      await emitFriendSync(io, User, req.userId, targetUserId, 'stranger');
      return res.json({
        message: 'Like removed',
        status: 'stranger',
      });
    }

    // Friends or mutual match: remove the relationship entirely
    if (
      friendship.status === 'friends' ||
      friendship.status === 'mutual_match' ||
      friendship.status === 'declined'
    ) {
      const prevStatus = friendship.status;
      await Friendship.deleteOne({ _id: friendship._id });
      const io = req.app.get('io');
      await emitFriendUpdate(io, User, targetUserId, req.userId, 'unlike', 'stranger');
      await emitFriendSync(io, User, req.userId, targetUserId, 'stranger');
      return res.json({
        message:
          prevStatus === 'friends'
            ? 'Friendship removed'
            : 'Relationship removed',
        status: 'stranger',
      });
    }

    return res.status(400).json({
      error: 'Cannot unlike in this state',
      status: friendship.status,
    });
  } catch (err) {
    console.error('friends/unlike error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/friends/unfriend
// Remove a friend (friends -> no relationship)
// ─────────────────────────────────────────────
router.delete('/unfriend', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);

    const result = await Friendship.deleteOne({ userA, userB, status: 'friends' });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Friendship not found or not friends' });
    }

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'unlike', 'stranger');
    await emitFriendSync(io, User, req.userId, targetUserId, 'stranger');

    res.json({ message: 'Friendship removed successfully' });
  } catch (err) {
    console.error('friends/unfriend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/block
// ─────────────────────────────────────────────
router.post('/block', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const target = await User.findById(targetUserId).select('_id');
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);
    let friendship = await Friendship.findOne({ userA, userB });

    if (friendship?.status === 'blocked' && String(friendship.blockedBy) === req.userId) {
      return res.json({ message: 'User already blocked', status: 'blocked' });
    }

    if (!friendship) {
      friendship = await Friendship.create({
        userA,
        userB,
        status: 'blocked',
        initiatedBy: req.userId,
        blockedBy: req.userId,
        blockedAt: new Date(),
      });
    } else {
      friendship.status = 'blocked';
      friendship.blockedBy = req.userId;
      friendship.blockedAt = new Date();
      friendship.friendsSince = null;
      friendship.acceptedBy = [];
      await friendship.save();
    }

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'block', 'blocked');

    // Both sides look offline to each other after a block
    try {
      const { notifyUser } = require('../utils/realtime');
      notifyUser(io, targetUserId, 'user:offline', {
        userId: String(req.userId),
        isOnline: false,
      });
      notifyUser(io, req.userId, 'user:offline', {
        userId: String(targetUserId),
        isOnline: false,
      });
      const room = [String(req.userId), String(targetUserId)].sort().join('_');
      if (io) {
        io.to(room).emit('user:offline', {
          userId: String(req.userId),
          isOnline: false,
        });
        io.to(room).emit('user:offline', {
          userId: String(targetUserId),
          isOnline: false,
        });
      }
    } catch {
      /* presence sync is best-effort */
    }

    res.json({ message: 'User blocked', status: 'blocked' });
  } catch (err) {
    console.error('friends/block error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/unblock
// ─────────────────────────────────────────────
router.post('/unblock', auth, async (req, res) => {
  try {
    const { userId: targetUserId } = req.body;

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);
    const friendship = await Friendship.findOne({ userA, userB });

    if (!friendship || friendship.status !== 'blocked') {
      return res.json({ message: 'User is not blocked', status: 'stranger' });
    }
    if (String(friendship.blockedBy) !== req.userId) {
      return res.status(403).json({
        error: 'Only the user who blocked can unblock',
        status: 'blocked',
      });
    }

    await Friendship.deleteOne({ _id: friendship._id });

    const io = req.app.get('io');
    await emitFriendUpdate(io, User, targetUserId, req.userId, 'unblock', 'stranger');

    // Instantly restore real online status for both sides
    try {
      const { notifyUser } = require('../utils/realtime');
      const multi = io?.onlineSockets;
      const single = io?.onlineUsers;
      const isUserOnline = (uid) => {
        const id = String(uid);
        if (multi instanceof Map) {
          const set = multi.get(id);
          if (set && set.size > 0) return true;
        }
        if (single instanceof Map && single.has(id)) return true;
        return false;
      };

      const meOnline = isUserOnline(req.userId);
      const themOnline = isUserOnline(targetUserId);
      const room = [String(req.userId), String(targetUserId)].sort().join('_');

      const mePayload = {
        userId: String(req.userId),
        isOnline: meOnline,
      };
      const themPayload = {
        userId: String(targetUserId),
        isOnline: themOnline,
      };

      notifyUser(
        io,
        targetUserId,
        meOnline ? 'user:online' : 'user:offline',
        mePayload,
      );
      notifyUser(
        io,
        req.userId,
        themOnline ? 'user:online' : 'user:offline',
        themPayload,
      );

      if (io) {
        io.to(room).emit(meOnline ? 'user:online' : 'user:offline', mePayload);
        io.to(room).emit(
          themOnline ? 'user:online' : 'user:offline',
          themPayload,
        );
      }
    } catch {
      /* presence sync is best-effort */
    }

    res.json({ message: 'User unblocked', status: 'stranger' });
  } catch (err) {
    console.error('friends/unblock error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// POST /api/friends/report
// Body: { userId, reason, details?, alsoBlock? }
// ─────────────────────────────────────────────
router.post('/report', auth, async (req, res) => {
  try {
    const Report = require('../models/Report');
    const { userId: targetUserId, reason, details = '', alsoBlock = false } = req.body || {};

    const REASONS = [
      'spam',
      'harassment',
      'inappropriate',
      'fake_profile',
      'underage',
      'other',
    ];

    if (!targetUserId || !targetUserId.match(/^[0-9a-f]{24}$/i)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    if (targetUserId === req.userId) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }
    if (!REASONS.includes(reason)) {
      return res.status(400).json({
        error: `reason must be one of: ${REASONS.join(', ')}`,
      });
    }

    const target = await User.findById(targetUserId).select('_id');
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Report.findOne({
      reporterId: req.userId,
      reportedUserId: targetUserId,
      createdAt: { $gte: since },
    }).select('_id');

    if (recent) {
      return res.status(429).json({
        error: 'You already reported this user recently. Thanks for helping keep Luvstor safe.',
        code: 'ALREADY_REPORTED',
      });
    }

    await Report.create({
      reporterId: req.userId,
      reportedUserId: targetUserId,
      reason,
      details: String(details || '').slice(0, 1000),
    });

    let blocked = false;
    if (alsoBlock) {
      const { userA, userB } = Friendship.getSortedPair(req.userId, targetUserId);
      let friendship = await Friendship.findOne({ userA, userB });
      if (!friendship) {
        await Friendship.create({
          userA,
          userB,
          status: 'blocked',
          initiatedBy: req.userId,
          blockedBy: req.userId,
          blockedAt: new Date(),
        });
      } else if (
        friendship.status !== 'blocked' ||
        String(friendship.blockedBy) !== req.userId
      ) {
        friendship.status = 'blocked';
        friendship.blockedBy = req.userId;
        friendship.blockedAt = new Date();
        friendship.friendsSince = null;
        friendship.acceptedBy = [];
        await friendship.save();
      }
      blocked = true;

      const io = req.app.get('io');
      await emitFriendUpdate(io, User, targetUserId, req.userId, 'block', 'blocked');
    }

    res.json({
      message: 'Report submitted. Thank you for helping keep Luvstor safe.',
      blocked,
    });
  } catch (err) {
    console.error('friends/report error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
