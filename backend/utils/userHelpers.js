/** True when the user finished in-app profile creation (not just Google name/photo). */
function isProfileComplete(user) {
  if (!user) return false;
  const name = String(user.name || '').trim();
  const gender = String(user.gender || '').trim();
  const photo = String(
    user.photo || (Array.isArray(user.photos) && user.photos[0]) || '',
  ).trim();
  const age = Number(user.age);
  const ageOk = Number.isFinite(age) && age >= 18;
  const bio = String(user.bio || '').trim();
  const interests = Array.isArray(user.interests)
    ? user.interests.filter((i) => String(i || '').trim())
    : [];
  const goal = String(user.relationshipGoal || '').trim();
  return Boolean(
    name && ageOk && gender && photo && bio && interests.length > 0 && goal,
  );
}

/**
 * Has this account ever finished first-time Profile Setup?
 * Gender + age only ever come from Profile Setup (Google gives name/photo),
 * so legacy accounts created before the flag existed still count.
 */
function hasCompletedProfileSetup(user) {
  if (!user) return false;
  if (user.profileCompleted === true) return true;
  if (user.welcomeTokensGrantedAt) return true;
  const name = String(user.name || '').trim();
  const gender = String(user.gender || '').trim();
  const age = Number(user.age);
  const ageOk = Number.isFinite(age) && age >= 18;
  if (name && gender && ageOk) return true;
  return isProfileComplete(user);
}

/** Persist profileCompleted=true once (never unset). Mutates `user` in memory. */
async function markProfileCompletedIfDone(user) {
  if (!user || user.profileCompleted === true) return !!user;
  if (!hasCompletedProfileSetup(user)) return false;
  const User = require('../models/User');
  const at = new Date();
  try {
    await User.updateOne(
      { _id: user._id, profileCompleted: { $ne: true } },
      { $set: { profileCompleted: true, profileCompletedAt: at } },
    );
  } catch (err) {
    console.warn('markProfileCompletedIfDone failed:', err?.message || err);
  }
  user.profileCompleted = true;
  user.profileCompletedAt = user.profileCompletedAt || at;
  return true;
}

function serializeUser(user) {
  const done = hasCompletedProfileSetup(user);
  return {
    id: user._id,
    publicId: user.publicId || '',
    email: user.email,
    name: user.name || '',
    authProvider: user.authProvider || 'email',
    age: user.age,
    bio: user.bio || '',
    gender: user.gender || '',
    interests: user.interests || [],
    relationshipGoal: user.relationshipGoal || '',
    photo: user.photo || '',
    height: user.height,
    isVerified: user.isVerified,
    profileComplete: done,
    profileCompleted: done,
  };
}

module.exports = {
  isProfileComplete,
  hasCompletedProfileSetup,
  markProfileCompletedIfDone,
  serializeUser,
};
