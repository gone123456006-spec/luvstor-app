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

function serializeUser(user) {
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
    profileComplete: isProfileComplete(user),
  };
}

module.exports = { isProfileComplete, serializeUser };
