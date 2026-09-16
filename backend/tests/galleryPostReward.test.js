/**
 * Gallery post first-add tokens: 5 each, once per slot, new users only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

const TEST_DB_NAME = 'luvstor_gallery_post_reward_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Bad URI: ${uri}`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

const { GALLERY_POST_TOKENS_PER_IMAGE } = require('../services/chatTokens');
const { MAX_PROFILE_PHOTOS } = require('../config/profileLimits');

let available = false;
let User;

/** Mirrors PUT /me gallery reward logic */
async function applyGalleryReward(userId, nextPhotos) {
  const before = await User.findById(userId)
    .select('photos galleryPostRewardCount galleryPostRewardInitialized tokenBalance')
    .lean();
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { photos: nextPhotos } },
    { returnDocument: 'after' },
  );

  const beforePhotos = Array.isArray(before.photos)
    ? before.photos.filter((u) => String(u || '').trim())
    : [];
  const afterPhotos = Array.isArray(user.photos)
    ? user.photos.filter((u) => String(u || '').trim())
    : [];
  const nextCount = Math.min(afterPhotos.length, MAX_PROFILE_PHOTOS);

  let rewardCount = Number(before.galleryPostRewardCount) || 0;
  let initialized = !!before.galleryPostRewardInitialized;
  let granted = 0;

  if (!initialized) {
    if (beforePhotos.length > 0) {
      rewardCount = MAX_PROFILE_PHOTOS;
    } else {
      rewardCount = 0;
    }
    initialized = true;
    await User.findByIdAndUpdate(userId, {
      $set: {
        galleryPostRewardInitialized: true,
        galleryPostRewardCount: rewardCount,
      },
    });
  }

  const slotsToReward = Math.max(0, nextCount - rewardCount);
  if (slotsToReward > 0 && rewardCount < MAX_PROFILE_PHOTOS) {
    const grantSlots = Math.min(slotsToReward, MAX_PROFILE_PHOTOS - rewardCount);
    const grantTokens = grantSlots * GALLERY_POST_TOKENS_PER_IMAGE;
    const updated = await User.findOneAndUpdate(
      { _id: userId, galleryPostRewardCount: { $lt: MAX_PROFILE_PHOTOS } },
      {
        $inc: {
          tokenBalance: grantTokens,
          galleryPostRewardCount: grantSlots,
        },
        $set: { galleryPostRewardInitialized: true },
      },
      { returnDocument: 'after' },
    ).select('tokenBalance galleryPostRewardCount');
    if (updated) granted = grantTokens;
  }

  const after = await User.findById(userId)
    .select('tokenBalance galleryPostRewardCount galleryPostRewardInitialized')
    .lean();
  return { granted, ...after };
}

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 8000 });
    available = true;
  } catch (err) {
    console.warn(`[gallery reward] skipped — ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing DB ${mongoose.connection.name}`);
  }
  User = require('../models/User');
  await mongoose.connection.dropDatabase();
  await User.init();
});

test.after(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('constant is 5 per image', async (t) => {
  if (!available) return t.skip('no MongoDB');
  assert.equal(GALLERY_POST_TOKENS_PER_IMAGE, 5);
});

test('new user gets 5 per first post images; remove+readd gives 0', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const user = await User.create({
    email: 'gallery-new@test.local',
    name: 'New',
    photos: [],
    tokenBalance: 0,
  });

  let r = await applyGalleryReward(user._id, ['/uploads/a/1.jpg']);
  assert.equal(r.granted, 5);
  assert.equal(r.tokenBalance, 5);
  assert.equal(r.galleryPostRewardCount, 1);

  r = await applyGalleryReward(user._id, [
    '/uploads/a/1.jpg',
    '/uploads/a/2.jpg',
  ]);
  assert.equal(r.granted, 5);
  assert.equal(r.tokenBalance, 10);
  assert.equal(r.galleryPostRewardCount, 2);

  // Remove all
  r = await applyGalleryReward(user._id, []);
  assert.equal(r.granted, 0);
  assert.equal(r.tokenBalance, 10);
  assert.equal(r.galleryPostRewardCount, 2);

  // Re-add 2 — no more tokens
  r = await applyGalleryReward(user._id, [
    '/uploads/a/3.jpg',
    '/uploads/a/4.jpg',
  ]);
  assert.equal(r.granted, 0);
  assert.equal(r.tokenBalance, 10);
  assert.equal(r.galleryPostRewardCount, 2);
});

test('existing user with gallery is locked out', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const user = await User.create({
    email: 'gallery-old@test.local',
    name: 'Old',
    photos: ['/uploads/b/1.jpg', '/uploads/b/2.jpg'],
    tokenBalance: 0,
  });

  let r = await applyGalleryReward(user._id, [
    '/uploads/b/1.jpg',
    '/uploads/b/2.jpg',
    '/uploads/b/3.jpg',
  ]);
  assert.equal(r.granted, 0);
  assert.equal(r.tokenBalance, 0);
  assert.equal(r.galleryPostRewardCount, MAX_PROFILE_PHOTOS);
});
