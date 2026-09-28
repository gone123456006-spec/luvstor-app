/** Shared shaping of app users for admin responses. */

const LIST_FIELDS =
  'name email publicId photo gender age authProvider isVerified isOnline lastSeen createdAt ' +
  'isDeactivated deletionScheduledAt deletionReason subscriptionPlan subscriptionExpiresAt ' +
  'tokenBalance photoVerification.status profileCompleted isBanned';

const PLAN_LABELS = { free: 'Free', explore: 'Explore Plus', gold: 'Gold', platinum: 'Platinum', black: 'Black' };
const PAID_PLANS = ['explore', 'gold', 'platinum', 'black'];

function accountStatus(u) {
  if (!u) return 'unknown';
  if (u.isBanned === true) return 'banned';
  if (u.isDeactivated && String(u.deletionReason || '').startsWith('moderation:')) return 'banned';
  if (u.deletionScheduledAt) return 'deleting';
  if (u.isDeactivated) return 'deactivated';
  return 'active';
}

function activePlan(u) {
  const plan = u?.subscriptionPlan || 'free';
  if (plan === 'free') return 'free';
  const exp = u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt) : null;
  return exp && exp > new Date() ? plan : 'free';
}

function listUser(u) {
  if (!u) return null;
  return {
    id: String(u._id),
    name: u.name || '',
    email: u.email || '',
    publicId: u.publicId || '',
    photo: u.photo || '',
    gender: u.gender || '',
    age: u.age ?? null,
    authProvider: u.authProvider || 'email',
    isOnline: !!u.isOnline,
    lastSeen: u.lastSeen || null,
    createdAt: u.createdAt || null,
    status: accountStatus(u),
    plan: activePlan(u),
    tokenBalance: Number(u.tokenBalance) || 0,
    photoVerification: u.photoVerification?.status || 'none',
    profileCompleted: !!u.profileCompleted,
  };
}

/** Minimal identity used when embedding users in other records. */
function refUser(u) {
  if (!u) return null;
  return {
    id: String(u._id),
    name: u.name || '',
    email: u.email || '',
    publicId: u.publicId || '',
    photo: u.photo || '',
    status: accountStatus(u),
  };
}

async function loadUserRefs(User, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await User.find({ _id: { $in: unique } })
    .select('name email publicId photo isDeactivated deletionReason deletionScheduledAt isBanned')
    .lean();
  return new Map(rows.map((u) => [String(u._id), refUser(u)]));
}

module.exports = {
  LIST_FIELDS,
  PLAN_LABELS,
  PAID_PLANS,
  accountStatus,
  activePlan,
  listUser,
  refUser,
  loadUserRefs,
};
