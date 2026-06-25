const jwt = require('jsonwebtoken');
const Message = require('../models/Message');
const User = require('../models/User');

// Helper: generate a consistent room ID from two user IDs
function roomId(a, b) {
  return [String(a), String(b)].sort().join('_');
}

module.exports = function initSocket(io) {
  // Map: userId → socket.id (for direct messaging)
  const onlineUsers = new Map();

  // JWT auth middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication error: No token'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = String(decoded.userId);
      next();
    } catch {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.userId;
    console.log(`✅ Socket connected: ${uid}`);

    // Track online status
    onlineUsers.set(uid, socket.id);
    await User.findByIdAndUpdate(uid, { isOnline: true, lastSeen: new Date() });
    io.emit('user:online', { userId: uid }); // Broadcast online status

    // ── Join a chat room ──────────────────────────────
    socket.on('chat:join', ({ otherUserId }) => {
      const room = roomId(uid, otherUserId);
      socket.join(room);
      console.log(`📌 ${uid} joined room ${room}`);
    });

    // ── Send a message ────────────────────────────────
    socket.on('chat:message', async (data) => {
      try {
        const { receiverId, text, type = 'text', mediaUrl = null, clientMsgId } = data;
        if (!receiverId || (!text && !mediaUrl)) return;

        const room = roomId(uid, receiverId);
        const message = await Message.create({
          roomId: room,
          senderId: uid,
          receiverId,
          text: text || '',
          type,
          mediaUrl,
        });

        const payload = {
          _id: message._id,
          roomId: room,
          senderId: uid,
          receiverId,
          text: message.text,
          type: message.type,
          mediaUrl: message.mediaUrl,
          read: message.read,
          createdAt: message.createdAt,
          clientMsgId,
        };

        // Emit to the room (both sender & receiver if in room)
        io.to(room).emit('chat:message', payload);

        // If receiver is online but NOT in the room, send a notification
        const receiverSocket = onlineUsers.get(String(receiverId));
        if (receiverSocket) {
          const receiverSockets = await io.in(room).allSockets();
          if (!receiverSockets.has(receiverSocket)) {
            io.to(receiverSocket).emit('chat:notification', {
              from: uid,
              roomId: room,
              text: message.text,
            });
          }
        }
      } catch (err) {
        console.error('chat:message error:', err);
        socket.emit('chat:error', { error: 'Failed to send message' });
      }
    });

    // ── Typing indicator ──────────────────────────────
    socket.on('chat:typing', ({ receiverId, isTyping }) => {
      const room = roomId(uid, receiverId);
      socket.to(room).emit('chat:typing', { senderId: uid, isTyping });
    });

    // ── Mark messages as read ─────────────────────────
    socket.on('chat:read', async ({ otherUserId }) => {
      try {
        const room = roomId(uid, otherUserId);
        await Message.updateMany(
          { roomId: room, receiverId: uid, read: false },
          { read: true }
        );
        socket.to(room).emit('chat:read', { by: uid });
      } catch (err) {
        console.error('chat:read error:', err);
      }
    });

    // ── Disconnect ────────────────────────────────────
    socket.on('disconnect', async () => {
      onlineUsers.delete(uid);
      await User.findByIdAndUpdate(uid, { isOnline: false, lastSeen: new Date() });
      io.emit('user:offline', { userId: uid });
      console.log(`❌ Socket disconnected: ${uid}`);
    });
  });

  return io;
};
