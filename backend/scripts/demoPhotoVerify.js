const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  const publicId = process.argv[2] || 'JLTG3686';
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ publicId }).select(
    'name publicId email photo photoVerification',
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
        email: user.email,
        photoVerification: user.photoVerification,
      },
      null,
      2,
    ),
  );

  const prev =
    (user.photoVerification && user.photoVerification.toObject
      ? user.photoVerification.toObject()
      : user.photoVerification) || {};

  user.photoVerification = {
    ...prev,
    status: 'approved',
    submittedAt: prev.submittedAt || new Date(),
    reviewedAt: new Date(),
    reviewNote: 'Demo photo verification badge',
    matchScore: 100,
    verifiedMainPhoto: String(user.photo || prev.verifiedMainPhoto || '').slice(
      0,
      500,
    ),
  };

  await user.save();

  const after = await User.findOne({ publicId }).select(
    'name publicId photoVerification',
  );
  console.log(
    'AFTER',
    JSON.stringify(
      {
        name: after.name,
        publicId: after.publicId,
        photoVerification: after.photoVerification,
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
