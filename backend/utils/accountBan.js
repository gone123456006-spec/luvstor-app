const User = require('../models/User');
const { setCachedActiveDevice } = require('./deviceSessionCache');

const BANNED_CODE = 'ACCOUNT_BANNED';
const BANNED_MESSAGE =
  'This account has been permanently blocked for violating our Community Guidelines.';

function isUserBanned(user) {
  return Boolean(user && user.isBanned === true);
}

function sendBanned(res) {
  return res.status(403).json({ error: BANNED_MESSAGE, code: BANNED_CODE });
}

/** Ends every live session of a user: auth cache, push tokens, sockets. */
async function revokeUserSessions(userId, io) {
  const uid = String(userId);
  setCachedActiveDevice(uid, null);
  try {
    const { removeTokensForUser } = require('../services/deviceTokens');
    await removeTokensForUser(uid);
  } catch (err) {
    console.warn('ban: push token cleanup failed:', err?.message || err);
  }
  if (io) {
    try {
      io.to(`user:${uid}`).emit('account:banned', { message: BANNED_MESSAGE });
      io.in(`user:${uid}`).disconnectSockets(true);
    } catch (err) {
      console.warn('ban: socket disconnect failed:', err?.message || err);
    }
  }
}

async function banUser(userId, { reason = '', io = null } = {}) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        isBanned: true,
        bannedAt: new Date(),
        banReason: String(reason || '').slice(0, 500) || null,
        isDeactivated: true,
        deletionReason: 'moderation:banned',
        // A scheduled deletion would let the login auto-restore lift the ban
        deletionScheduledAt: null,
        activeDeviceId: null,
        isOnline: false,
      },
    },
    { returnDocument: 'after' },
  ).select('_id email isBanned');
  if (!user) return null;
  await revokeUserSessions(user._id, io);
  return user;
}

async function unbanUser(userId) {
  return User.findByIdAndUpdate(
    userId,
    {
      $set: {
        isBanned: false,
        bannedAt: null,
        banReason: null,
        isDeactivated: false,
        deletionReason: null,
      },
    },
    { returnDocument: 'after' },
  ).select('_id email isBanned');
}

module.exports = {
  BANNED_CODE,
  BANNED_MESSAGE,
  isUserBanned,
  sendBanned,
  revokeUserSessions,
  banUser,
  unbanUser,
};
