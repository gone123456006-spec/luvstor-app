const Friendship = require('../models/Friendship');

/**
 * Resolve block state between two users.
 *
 * @returns {{
 *   blocked: boolean,
 *   iBlocked: boolean,   // viewer blocked the other
 *   theyBlocked: boolean,
 *   blockedAt: Date|null,
 *   blockedBy: string|null,
 * }}
 */
async function getBlockState(viewerId, otherId) {
  const empty = {
    blocked: false,
    iBlocked: false,
    theyBlocked: false,
    blockedAt: null,
    blockedBy: null,
  };

  if (!viewerId || !otherId) return empty;

  const { userA, userB } = Friendship.getSortedPair(viewerId, otherId);
  const friendship = await Friendship.findOne({
    userA,
    userB,
    status: 'blocked',
  })
    .select('blockedBy blockedAt')
    .lean();

  if (!friendship) return empty;

  const blockedBy = friendship.blockedBy ? String(friendship.blockedBy) : null;
  const iBlocked = blockedBy === String(viewerId);
  const theyBlocked = blockedBy === String(otherId);

  return {
    blocked: true,
    iBlocked,
    theyBlocked,
    blockedAt: friendship.blockedAt || null,
    blockedBy,
  };
}

module.exports = { getBlockState };
