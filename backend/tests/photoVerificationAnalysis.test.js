/**
 * Verifies 30-minute photo analysis → approve/reject (+30 tokens once).
 * Uses throwaway DB luvstor_photo_verify_test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

const TEST_DB_NAME = 'luvstor_photo_verify_test';

function withTestDatabase(uri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/[^?]*)?(\?.*)?$/.exec(uri);
  if (!match) throw new Error(`Bad URI: ${uri}`);
  return `${match[1]}/${TEST_DB_NAME}${match[2] || ''}`;
}

const TEST_URI = withTestDatabase(
  process.env.MONGO_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017',
);

let available = false;
let User;
let createChallenge;
let verifyChallengeToken;
let REVIEW_DELAY_MS;
let finalizePendingAnalysis;
let approveDuePhotoVerifications;
let PHOTO_VERIFICATION_TOKENS;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 8000 });
    available = true;
  } catch (err) {
    console.warn(`[photo verify] skipped — no MongoDB: ${err.message}`);
    return;
  }
  if (mongoose.connection.name !== TEST_DB_NAME) {
    throw new Error(`Refusing DB "${mongoose.connection.name}"`);
  }
  User = require('../models/User');
  ({
    createChallenge,
    verifyChallengeToken,
    REVIEW_DELAY_MS,
  } = require('../services/photoFaceMatch'));
  ({
    finalizePendingAnalysis,
    approveDuePhotoVerifications,
  } = require('../routes/verification'));
  ({ PHOTO_VERIFICATION_TOKENS } = require('../services/chatTokens'));
  await mongoose.connection.dropDatabase();
  await User.init();
});

test.after(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('challenge token validates pose', async (t) => {
  if (!available) return t.skip('no MongoDB');
  const ch = createChallenge();
  assert.ok(['smile', 'turn_left', 'turn_right'].includes(ch.pose));
  const ok = verifyChallengeToken(ch.challengeToken, ch.pose);
  assert.equal(ok.ok, true);
  const bad = verifyChallengeToken(ch.challengeToken, 'smile');
  if (ch.pose !== 'smile') assert.equal(bad.ok, false);
});

test('REVIEW_DELAY_MS is 30 minutes', async (t) => {
  if (!available) return t.skip('no MongoDB');
  assert.equal(REVIEW_DELAY_MS, 30 * 60 * 1000);
  assert.equal(PHOTO_VERIFICATION_TOKENS, 30);
});

test('pending stays pending until 30 minutes, then analyses', async (t) => {
  if (!available) return t.skip('no MongoDB');

  // Tiny valid jpeg so dating-mode image size checks can pass
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'testverify');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
    'base64',
  );
  // Make buffers large enough (>= 8KB) for dating score
  const big = Buffer.concat([jpeg, Buffer.alloc(9000, 1)]);
  const profilePath = path.join(uploadsDir, 'profile.jpg');
  const selfiePath = path.join(uploadsDir, 'selfie.jpg');
  fs.writeFileSync(profilePath, big);
  // Different bytes so not exact duplicate
  const selfieBuf = Buffer.concat([jpeg, Buffer.alloc(9000, 2)]);
  fs.writeFileSync(selfiePath, selfieBuf);

  const profileUrl = '/uploads/testverify/profile.jpg';
  const selfieUrl = '/uploads/testverify/selfie.jpg';

  const user = await User.create({
    email: 'photo-analysis@test.local',
    name: 'Verify Me',
    age: 25,
    gender: 'Male',
    photo: profileUrl,
    photos: [profileUrl],
    bio: 'Test bio here',
    interests: ['Music'],
    relationshipGoal: 'Dating',
    tokenBalance: 0,
    photoVerification: {
      status: 'pending',
      selfieUrl,
      pose: 'smile',
      submittedAt: new Date(), // just now
      reviewNote: 'Analysing…',
    },
  });

  // Too early — must not finalize
  const early = await finalizePendingAnalysis(user._id, null, '');
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'too_early');

  let still = await User.findById(user._id).select('photoVerification tokenBalance').lean();
  assert.equal(still.photoVerification.status, 'pending');
  assert.equal(still.tokenBalance, 0);

  // Backdate past 30 minutes → analysis runs
  await User.findByIdAndUpdate(user._id, {
    $set: {
      'photoVerification.submittedAt': new Date(Date.now() - REVIEW_DELAY_MS - 1000),
    },
  });

  const done = await finalizePendingAnalysis(user._id, null, '');
  assert.equal(done.ok, true);
  assert.ok(done.decision === 'approve' || done.decision === 'reject');

  still = await User.findById(user._id).select('photoVerification tokenBalance photoVerificationTokensGrantedAt').lean();
  assert.ok(['approved', 'rejected'].includes(still.photoVerification.status));

  if (done.decision === 'approve') {
    assert.equal(still.photoVerification.status, 'approved');
    assert.equal(still.tokenBalance, 30);
    assert.ok(still.photoVerificationTokensGrantedAt);
    assert.equal(done.verificationTokensGranted, 30);

    // Second finalize must no-op (not pending)
    const again = await finalizePendingAnalysis(user._id, null, '');
    assert.equal(again.ok, false);
    const bal = await User.findById(user._id).select('tokenBalance').lean();
    assert.equal(bal.tokenBalance, 30);
  } else {
    assert.equal(still.photoVerification.status, 'rejected');
    assert.equal(still.tokenBalance, 0);
  }

  // Cleanup files
  try {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('batch job picks overdue pending', async (t) => {
  if (!available) return t.skip('no MongoDB');

  const uploadsDir = path.join(__dirname, '..', 'uploads', 'testverify2');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
    'base64',
  );
  const profile = Buffer.concat([jpeg, Buffer.alloc(9000, 3)]);
  const selfie = Buffer.concat([jpeg, Buffer.alloc(9000, 4)]);
  fs.writeFileSync(path.join(uploadsDir, 'p.jpg'), profile);
  fs.writeFileSync(path.join(uploadsDir, 's.jpg'), selfie);

  await User.create({
    email: 'batch-verify@test.local',
    name: 'Batch',
    age: 22,
    gender: 'Female',
    photo: '/uploads/testverify2/p.jpg',
    photos: ['/uploads/testverify2/p.jpg'],
    bio: 'Bio text',
    interests: ['Art'],
    relationshipGoal: 'Friends',
    tokenBalance: 10,
    photoVerification: {
      status: 'pending',
      selfieUrl: '/uploads/testverify2/s.jpg',
      pose: 'turn_left',
      submittedAt: new Date(Date.now() - REVIEW_DELAY_MS - 5000),
    },
  });

  const n = await approveDuePhotoVerifications(null);
  assert.ok(n >= 1);

  const u = await User.findOne({ email: 'batch-verify@test.local' })
    .select('photoVerification')
    .lean();
  assert.ok(['approved', 'rejected'].includes(u.photoVerification.status));

  try {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
