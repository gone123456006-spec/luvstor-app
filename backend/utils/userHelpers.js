/** True when the user finished onboarding (has a display name). */
function isProfileComplete(user) {
  return Boolean(user?.name && String(user.name).trim().length > 0);
}

function serializeUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name || '',
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
