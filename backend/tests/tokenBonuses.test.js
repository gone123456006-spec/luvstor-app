/**
 * Verifies one-time welcome (50) + photo-verification (30) token grants.
 * Uses throwaway DB luvstor_token_bonus_test — never touches prod data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

const TEST_DB_NAME = 'luvstor_token_bonus_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) {
    throw new Error(`Bad URI for test DB rewrite: ${uri}`);
  }
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

let available = false;
let User;
let isProfileComplete;
let WELCOME_PROFILE_TOKENS;
let PHOTO_VERIFICATION_TOKENS;

async function completeProfileAndGrantWelcome(userId, profileUpdates) {
  const before = await User.findById(userId)
    .select(
      'name age bio gender photo photos interests relationshipGoal welcomeTokensGrantedAt tokenBalance',
    )
    .lean();
  const wasComplete = isProfileComplete(before);

  const user = await User.findByIdAndUpdate(userId, profileUpdates, {
    returnDocument: 'after',
  });

  let welcomeTokensGranted = 0;
  if (
    !wasComplete &&
    isProfileComplete(user) &&
    !before.welcomeTokensGrantedAt
  ) {
    const granted = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { welcomeTokensGrantedAt: null },
          { welcomeTokensGrantedAt: { $exists: false } },
        ],
      },
      {
        $inc: { tokenBalance: WELCOME_PROFILE_TOKENS },
        $set: { welcomeTokensGrantedAt: new Date() },
      },
      { returnDocument: 'after' },
    ).select('tokenBalance welcomeTokensGrantedAt');
    if (granted) welcomeTokensGranted = WELCOME_PROFILE_TOKENS;
  }
  const after = await User.findById(userId)
    .select('tokenBalance welcomeTokensGrantedAt')
    .lean();
  return {
    welcomeTokensGranted,
    tokenBalance: after.tokenBalance,
    welcomeTokensGrantedAt: after.welcomeTokensGrantedAt,
  };
}

async function approvePhotoAndGrant(userId) {
  const user = await User.findOneAndUpdate(
    { _id: userId, 'photoVerification.status': 'pending' },
    {
      $set: {
        'photoVerification.status': 'approved',
        'photoVerification.reviewedAt': new Date(),
      },
    },
    { returnDocument: 'after' },
  ).select('photoVerification tokenBalance photoVerificationTokensGrantedAt');

  let verificationTokensGranted = 0;
  let tokenBalance = user?.tokenBalance ?? 0;
  if (user && !user.photoVerificationTokensGrantedAt) {
    const granted = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { photoVerificationTokensGrantedAt: null },
          { photoVerificationTokensGrantedAt: { $exists: false } },
        ],
      },
      {
        $inc: { tokenBalance: PHOTO_VERIFICATION_TOKENS },
        $set: { photoVerificationTokensGrantedAt: new Date() },
      },
      { returnDocument: 'after' },
    ).select('tokenBalance');
    if (granted) {
      verificationTokensGranted = PHOTO_VERIFICATION_TOKENS;
      tokenBalance = granted.tokenBalance;
    }
  }
  return { verificationTokensGranted, tokenBalance, status: user?.photoVerification?.status };
}

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 8000 });
    available = true;
  } catch (err) {
    console.warn(`[token bonuses] skipped — no MongoDB: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing to use DB "${mongoose.connection.name}"`);
  }
  User = require('../models/User');
  ({ isProfileComplete } = require('../utils/userHelpers'));
  ({
    WELCOME_PROFILE_TOKENS,
    PHOTO_VERIFICATION_TOKENS,
  } = require('../services/chatTokens'));
  await mongoose.connection.dropDatabase();
  await User.init();
});

test.after(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('welcome 50 tokens once on first profile complete', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const user = await User.create({
    email: 'welcome-bonus@test.local',
    name: '',
    tokenBalance: 0,
  });

  const completeFields = {
    name: 'Test User',
    age: 25,
    gender: 'Male',
    photo: '/uploads/x/a.jpg',
    bio: 'Hello world bio',
    interests: ['Music'],
    relationshipGoal: 'Dating',
  };

  const first = await completeProfileAndGrantWelcome(user._id, completeFields);
  assert.equal(first.welcomeTokensGranted, 50);
  assert.equal(first.tokenBalance, 50);
  assert.ok(first.welcomeTokensGrantedAt);

  // Already complete — no second grant
  const second = await completeProfileAndGrantWelcome(user._id, {
    bio: 'Updated bio again',
  });
  assert.equal(second.welcomeTokensGranted, 0);
  assert.equal(second.tokenBalance, 50);
});

test('photo verification 30 tokens once on approve', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const user = await User.create({
    email: 'photo-bonus@test.local',
    name: 'Photo User',
    age: 22,
    gender: 'Female',
    photo: '/uploads/x/b.jpg',
    bio: 'Bio text here',
    interests: ['Art'],
    relationshipGoal: 'Friends',
    tokenBalance: 50,
    welcomeTokensGrantedAt: new Date(),
    photoVerification: {
      status: 'pending',
      selfieUrl: '/uploads/x/selfie.jpg',
      submittedAt: new Date(),
    },
  });

  const first = await approvePhotoAndGrant(user._id);
  assert.equal(first.status, 'approved');
  assert.equal(first.verificationTokensGranted, 30);
  assert.equal(first.tokenBalance, 80);

  // Re-run grant guard with already-set timestamp
  const again = await User.findOneAndUpdate(
    {
      _id: user._id,
      $or: [
        { photoVerificationTokensGrantedAt: null },
        { photoVerificationTokensGrantedAt: { $exists: false } },
      ],
    },
    {
      $inc: { tokenBalance: PHOTO_VERIFICATION_TOKENS },
      $set: { photoVerificationTokensGrantedAt: new Date() },
    },
    { returnDocument: 'after' },
  );
  assert.equal(again, null);

  const final = await User.findById(user._id).select('tokenBalance').lean();
  assert.equal(final.tokenBalance, 80);
});

test('constants are 50 and 30', async (t) => {
  if (!available) return t.skip('no MongoDB');
  assert.equal(WELCOME_PROFILE_TOKENS, 50);
  assert.equal(PHOTO_VERIFICATION_TOKENS, 30);
});
