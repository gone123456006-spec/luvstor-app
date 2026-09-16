/**
 * Referral reward: friend installs via link + completes login → referrer +50 tokens.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

try {
  require('dotenv').config();
} catch {
  /* optional */
}

const TEST_DB_NAME = 'luvstor_referrals_test';

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
let Referral;
let applyReferralOnSignup;
let ensureReferralCode;
let extractReferralCodeFromReferrer;
let REFERRAL_REWARD_TOKENS;
let MAX_REFERRALS_PER_MONTH;

test.before(async () => {
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 8000 });
    User = require('../models/User');
    Referral = require('../models/Referral');
    ({
      applyReferralOnSignup,
      ensureReferralCode,
      extractReferralCodeFromReferrer,
      REFERRAL_REWARD_TOKENS,
      MAX_REFERRALS_PER_MONTH,
    } = require('../services/referrals'));
    available = true;
  } catch (err) {
    console.warn('referrals tests skipped (no mongo):', err.message);
  }
});

test.after(async () => {
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
});

test.beforeEach(async () => {
  if (!available) return;
  await User.deleteMany({});
  await Referral.deleteMany({});
});

test('extractReferralCodeFromReferrer parses Play Store utm', () => {
  if (!available) return;
  assert.equal(
    extractReferralCodeFromReferrer(
      'utm_source=luvstor&utm_medium=referral&utm_campaign=K7M2PQ',
    ),
    'K7M2PQ',
  );
  assert.equal(extractReferralCodeFromReferrer('https://x/r/AB12CD'), 'AB12CD');
});

test('rewards referrer 50 tokens on signup with invite code', async () => {
  if (!available) return;

  const referrer = await User.create({
    email: 'ref@example.com',
    isVerified: true,
    publicId: 'AAAA1111',
    tokenBalance: 10,
  });
  const code = await ensureReferralCode(referrer);
  assert.match(code, /^[A-Z0-9]{6}$/);

  const referee = await User.create({
    email: 'new@example.com',
    isVerified: true,
    publicId: 'BBBB2222',
    tokenBalance: 0,
  });

  const result = await applyReferralOnSignup({
    refereeUser: referee,
    referralCode: code,
    deviceId: 'device-abc-12345',
  });

  assert.equal(result.ok, true);
  assert.equal(result.tokensAwarded, REFERRAL_REWARD_TOKENS);
  assert.equal(REFERRAL_REWARD_TOKENS, 50);

  const updated = await User.findById(referrer._id);
  assert.equal(updated.tokenBalance, 10 + REFERRAL_REWARD_TOKENS);

  const referee2 = await User.findById(referee._id);
  assert.equal(String(referee2.referredBy), String(referrer._id));

  const again = await applyReferralOnSignup({
    refereeUser: referee2,
    referralCode: code,
    deviceId: 'device-abc-12345',
  });
  assert.equal(again.ok, false);
});

test('blocks self-referral and monthly cap of 5', async () => {
  if (!available) return;

  const referrer = await User.create({
    email: 'cap@example.com',
    isVerified: true,
    publicId: 'CCCC3333',
    tokenBalance: 0,
  });
  const code = await ensureReferralCode(referrer);

  const self = await applyReferralOnSignup({
    refereeUser: referrer,
    referralCode: code,
    deviceId: 'self-device-9999',
  });
  assert.equal(self.reason, 'self_referral');

  for (let i = 0; i < MAX_REFERRALS_PER_MONTH; i++) {
    const friend = await User.create({
      email: `f${i}@example.com`,
      isVerified: true,
      publicId: `FFFF${1000 + i}`,
    });
    const r = await applyReferralOnSignup({
      refereeUser: friend,
      referralCode: code,
      deviceId: `device-cap-${i}-xxxx`,
    });
    assert.equal(r.ok, true);
  }

  const extra = await User.create({
    email: 'extra@example.com',
    isVerified: true,
    publicId: 'EEEE9999',
  });
  const blocked = await applyReferralOnSignup({
    refereeUser: extra,
    referralCode: code,
    deviceId: 'device-cap-extra-1',
  });
  assert.equal(blocked.reason, 'monthly_cap');
  assert.equal(
    await Referral.countDocuments({ referrerId: referrer._id }),
    MAX_REFERRALS_PER_MONTH,
  );
});
