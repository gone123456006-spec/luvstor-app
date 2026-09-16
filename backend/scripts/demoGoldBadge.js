const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  const publicId = process.argv[2] || 'JLTG3686';
  const plan = String(process.argv[3] || 'gold').toLowerCase();
  const allowed = new Set(['gold', 'platinum', 'black']);
  if (!allowed.has(plan)) {
    console.error('Plan must be gold | platinum | black');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ publicId }).select(
    'name publicId email subscriptionPlan subscriptionExpiresAt photoVerification',
  );
  if (!user) {
    console.log('USER_NOT_FOUND', publicId);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(
    'BEFORE',
    JSON.stringify(
      {
        name: user.name,
        publicId: user.publicId,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        photoVerification: user.photoVerification?.status,
      },
      null,
      2,
    ),
  );

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  user.subscriptionPlan = plan;
  user.subscriptionExpiresAt = expiresAt;

  // Keep demo photo verification too
  const prev =
    (user.photoVerification && user.photoVerification.toObject
      ? user.photoVerification.toObject()
      : user.photoVerification) || {};
  user.photoVerification = {
    ...prev,
    status: 'approved',
    submittedAt: prev.submittedAt || new Date(),
    reviewedAt: prev.reviewedAt || new Date(),
    reviewNote: prev.reviewNote || 'Demo photo verification badge',
    matchScore: prev.matchScore ?? 100,
    verifiedMainPhoto: prev.verifiedMainPhoto || '',
  };

  await user.save();

  const after = await User.findOne({ publicId }).select(
    'name publicId subscriptionPlan subscriptionExpiresAt photoVerification',
  );
  console.log(
    'AFTER',
    JSON.stringify(
      {
        name: after.name,
        publicId: after.publicId,
        subscriptionPlan: after.subscriptionPlan,
        subscriptionExpiresAt: after.subscriptionExpiresAt,
        photoVerification: after.photoVerification?.status,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
  console.log('DONE');
})().catch(async (e) => {
  console.error('ERROR', e.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
