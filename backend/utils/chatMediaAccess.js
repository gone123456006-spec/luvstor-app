const Message = require('../models/Message');

function roomId(userId1, userId2) {
  return [String(userId1), String(userId2)].sort().join('_');
}

/**
 * Media (image / voice) unlocks only after both users have sent at least one DM.
 * Text stays open either way (subject to other chat rules).
 */
async function hasBidirectionalChat(userId1, userId2) {
  if (!userId1 || !userId2) return false;
  if (String(userId1) === String(userId2)) return false;

  const room = roomId(userId1, userId2);
  const base = {
    roomId: room,
    isDeleted: { $ne: true },
    type: { $in: ['text', 'image', 'audio'] },
  };

  const [aSent, bSent] = await Promise.all([
    Message.exists({ ...base, senderId: userId1 }),
    Message.exists({ ...base, senderId: userId2 }),
  ]);

  return !!(aSent && bSent);
}

module.exports = {
  roomId,
  hasBidirectionalChat,
};
