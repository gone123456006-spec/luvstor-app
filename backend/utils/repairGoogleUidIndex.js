/**
 * Fix googleUid unique index: MongoDB treats multiple `null` values as duplicates
 * unless the index is sparse AND the field is absent (not null).
 */
async function repairGoogleUidIndex() {
  const User = require('../models/User');
  const collection = User.collection;

  const unset = await User.updateMany(
    {
      $or: [
        { googleUid: { $type: 'null' } },
        { googleUid: '' },
      ],
    },
    { $unset: { googleUid: 1 } },
  );

  if (unset.modifiedCount > 0) {
    console.log(`🔧 Cleared googleUid on ${unset.modifiedCount} email-only user(s)`);
  }

  try {
    const indexes = await collection.indexes();
    const googleIdx = indexes.find((idx) => idx.name === 'googleUid_1');
    if (googleIdx && !googleIdx.sparse) {
      await collection.dropIndex('googleUid_1');
      console.log('🔧 Dropped non-sparse googleUid_1 index');
    }
  } catch (err) {
    if (err.code !== 27 && err.codeName !== 'IndexNotFound') {
      console.warn('googleUid index drop warning:', err.message);
    }
  }

  try {
    await collection.createIndex(
      { googleUid: 1 },
      { unique: true, sparse: true, name: 'googleUid_1' },
    );
  } catch (err) {
    // Already exists with correct options
    if (err.code !== 85 && err.code !== 86) {
      console.warn('googleUid index create warning:', err.message);
    }
  }
}

/**
 * Same pattern for referralCode — never store null; omit until assigned.
 */
async function repairReferralCodeIndex() {
  const User = require('../models/User');
  const collection = User.collection;

  const unset = await User.updateMany(
    {
      $or: [
        { referralCode: { $type: 'null' } },
        { referralCode: '' },
      ],
    },
    { $unset: { referralCode: 1 } },
  );

  if (unset.modifiedCount > 0) {
    console.log(`🔧 Cleared empty referralCode on ${unset.modifiedCount} user(s)`);
  }

  try {
    const indexes = await collection.indexes();
    const idx = indexes.find((i) => i.name === 'referralCode_1');
    if (idx && !idx.sparse) {
      await collection.dropIndex('referralCode_1');
      console.log('🔧 Dropped non-sparse referralCode_1 index');
    }
  } catch (err) {
    if (err.code !== 27 && err.codeName !== 'IndexNotFound') {
      console.warn('referralCode index drop warning:', err.message);
    }
  }

  try {
    await collection.createIndex(
      { referralCode: 1 },
      { unique: true, sparse: true, name: 'referralCode_1' },
    );
  } catch (err) {
    if (err.code !== 85 && err.code !== 86) {
      console.warn('referralCode index create warning:', err.message);
    }
  }
}

module.exports = { repairGoogleUidIndex, repairReferralCodeIndex };
