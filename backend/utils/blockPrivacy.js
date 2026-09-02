const { getBlockState } = require('./blockState');

/**
 * Privacy for blocked relationships (WhatsApp-like):
 * - Either side blocked → both look Offline to each other
 * - They blocked you → also hide DP (gray silhouette); name stays
 * - You blocked them → you still see their photo, but offline
 */
async function applyBlockPrivacy(viewerId, otherUser) {
  if (!otherUser) return null;

  const otherId = String(otherUser._id || otherUser.id || '');
  if (!viewerId || !otherId) return otherUser;

  const block = await getBlockState(viewerId, otherId);
  if (!block.blocked) {
    return {
      ...otherUser,
      iBlocked: false,
      theyBlocked: false,
      blockedAt: null,
      privacyHidden: false,
    };
  }

  if (block.theyBlocked) {
    return {
      ...otherUser,
      photo: '',
      photos: [],
      isOnline: false,
      lastSeen: null,
      iBlocked: false,
      theyBlocked: true,
      blockedAt: block.blockedAt,
      privacyHidden: true,
    };
  }

  // Viewer blocked the other — still see DP, always show Offline
  return {
    ...otherUser,
    isOnline: false,
    lastSeen: null,
    iBlocked: true,
    theyBlocked: false,
    blockedAt: block.blockedAt,
    privacyHidden: false,
  };
}

/** True if either side has blocked the other (hide from Discover, etc.). */
async function isEitherBlocked(userId1, userId2) {
  const block = await getBlockState(userId1, userId2);
  return block.blocked;
}

module.exports = {
  applyBlockPrivacy,
  isEitherBlocked,
  getBlockState,
};
