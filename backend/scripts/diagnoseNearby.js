require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const total = await User.countDocuments({});
  const verified = await User.countDocuments({ isVerified: true });
  const named = await User.countDocuments({ name: { $nin: [null, ''] } });
  const withLoc = await User.countDocuments({
    'location.coordinates': { $ne: [0, 0] },
  });
  const eligible = await User.countDocuments({
    isVerified: true,
    isDeactivated: { $ne: true },
    deletionScheduledAt: null,
    name: { $nin: [null, ''] },
    'location.coordinates': { $ne: [0, 0] },
  });
  const genders = await User.aggregate([
    { $group: { _id: '$gender', n: { $sum: 1 } } },
  ]);
  console.log('Counts:', { total, verified, named, withLoc, eligible });
  console.log('Genders:', genders);
  const sample = await User.find({ isVerified: true })
    .select('email name gender showMe discoveryPrefs location.coordinates')
    .lean();
  console.log(
    'Users:',
    sample.map((u) => ({
      email: u.email,
      name: u.name,
      gender: u.gender,
      showMe: u.showMe,
      prefs: u.discoveryPrefs,
      loc: u.location?.coordinates,
    })),
  );

  const { buildNearbyBatch } = require('../services/discovery');
  const { resolveShowMe, toGenderFilter } = require('../utils/showMe');

  for (const viewer of sample) {
    if (!viewer.location?.coordinates) continue;
    const genderFilter = toGenderFilter(
      resolveShowMe(viewer, viewer.discoveryPrefs?.gender),
    );
    const batch = await buildNearbyBatch({
      viewer,
      radiusMetres: 500000,
      genderFilter,
      activeWithinMinutes: 0,
      excludeIds: [],
      targetCount: 25,
      trackImpressions: false,
    });
    console.log(
      `Viewer ${viewer.name || viewer.email} filter=${genderFilter} (showMe=${viewer.showMe}):`,
      batch.users.length,
      'users',
      batch.users.map((u) => `${u.name}(${u.gender})`),
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
