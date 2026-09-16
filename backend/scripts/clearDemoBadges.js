const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  const publicId = process.argv[2] || 'JLTG3686';
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000,
  });

  const user = await User.findOne({ publicId });
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

  user.subscriptionPlan = 'free';
  user.subscriptionExpiresAt = null;
  user.photoVerification = {
    status: 'none',
    selfieUrl: '',
    submittedAt: null,
    reviewedAt: null,
    reviewNote: '',
    pose: '',
    matchScore: null,
    verifiedMainPhoto: '',
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
