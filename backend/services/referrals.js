/**
 * Referral rewards: friend installs via your link + completes login → you get 50 tokens.
 * Cap: 5 successful referrals per calendar month (UTC).
 */
const crypto = require('crypto');
const User = require('../models/User');
const Referral = require('../models/Referral');

const REFERRAL_REWARD_TOKENS = 50;
const MAX_REFERRALS_PER_MONTH = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRangeUtc(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

function normalizeReferralCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function generateReferralCodeCandidate() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

async function ensureReferralCode(user) {
  if (!user) return null;
  const existing = normalizeReferralCode(user.referralCode);
  if (existing && existing.length >= 4) {
    user.referralCode = existing;
    return existing;
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateReferralCodeCandidate();
    const taken = await User.exists({ referralCode: candidate });
    if (taken) continue;
    user.referralCode = candidate;
    await user.save();
    return candidate;
  }
  throw new Error('Could not assign referral code');
}

function playStoreUrlForCode(code) {
  const pkg =
    process.env.ANDROID_PACKAGE_ID ||
    process.env.EXPO_PUBLIC_ANDROID_PACKAGE ||
    'com.luvstor.app';
  const referrer = encodeURIComponent(
    `utm_source=luvstor&utm_medium=referral&utm_campaign=${code}`,
  );
  return `https://play.google.com/store/apps/details?id=${pkg}&referrer=${referrer}`;
}

/** Legacy API bounce path (kept for deep-link fallbacks). Prefer branded shareLinks. */
function referralHttpsUrl(code) {
  const base = (
    process.env.PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    'https://luvstor-api.onrender.com'
  ).replace(/\/$/, '');
  return `${base}/r/${code}`;
}

async function referralShareUrlForUser(user) {
  const { ensureReferralShareLink } = require('./shareLinks');
  const code = await ensureReferralCode(user);
  const link = await ensureReferralShareLink({
    referralCode: code,
    ownerUserId: user._id,
  });
  return {
    referralCode: code,
    shareUrl: link?.shareUrl || referralHttpsUrl(code),
    playStoreUrl: playStoreUrlForCode(code),
    slug: link?.slug || null,
  };
}

/**
 * Apply referral after a brand-new user completes login.
 * Idempotent: referee can only be attributed once.
 */
async function applyReferralOnSignup({
  refereeUser,
  referralCode,
  deviceId,
  io,
}) {
  const code = normalizeReferralCode(referralCode);
  if (!code || !refereeUser?._id) {
    return { ok: false, reason: 'missing_code' };
  }

  // Already attributed
  if (refereeUser.referredBy) {
    return { ok: false, reason: 'already_attributed' };
  }

  const referrer = await User.findOne({ referralCode: code }).select(
    '_id referralCode name publicId tokenBalance',
  );
  if (!referrer) {
    return { ok: false, reason: 'invalid_code' };
  }
  if (String(referrer._id) === String(refereeUser._id)) {
    return { ok: false, reason: 'self_referral' };
  }

  const { start, end } = monthRangeUtc();
  const monthCount = await Referral.countDocuments({
    referrerId: referrer._id,
    status: 'rewarded',
    createdAt: { $gte: start, $lt: end },
  });
  if (monthCount >= MAX_REFERRALS_PER_MONTH) {
    return { ok: false, reason: 'monthly_cap' };
  }

  const device = String(deviceId || '').trim();
  if (device.length >= 8) {
    const deviceUsed = await Referral.exists({
      refereeDeviceId: device,
      status: 'rewarded',
    });
    if (deviceUsed) {
      return { ok: false, reason: 'device_already_used' };
    }
  }

  // Atomic claim on referee
  const claimed = await User.findOneAndUpdate(
    {
      _id: refereeUser._id,
      $or: [{ referredBy: null }, { referredBy: { $exists: false } }],
    },
    {
      $set: {
        referredBy: referrer._id,
        referredAt: new Date(),
        referralCodeUsed: code,
      },
    },
    { returnDocument: 'after' },
  ).select('_id referredBy');

  if (!claimed) {
    return { ok: false, reason: 'already_attributed' };
  }

  try {
    await Referral.create({
      referrerId: referrer._id,
      refereeId: refereeUser._id,
      code,
      refereeDeviceId: device || null,
      tokensAwarded: REFERRAL_REWARD_TOKENS,
      status: 'rewarded',
      monthKey: monthKey(),
    });
  } catch (err) {
    // Unique index race — roll back attribution if insert failed
    if (err?.code === 11000) {
      await User.findByIdAndUpdate(refereeUser._id, {
        $unset: { referredBy: 1, referredAt: 1, referralCodeUsed: 1 },
      });
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }

  const updatedReferrer = await User.findByIdAndUpdate(
    referrer._id,
    { $inc: { tokenBalance: REFERRAL_REWARD_TOKENS } },
    { returnDocument: 'after' },
  ).select('tokenBalance');

  try {
    const { createNotification } = require('./notifications');
    await createNotification(io, {
      userId: referrer._id,
      type: 'token',
      title: 'Referral reward!',
      body: `You earned ${REFERRAL_REWARD_TOKENS} tokens — your friend joined Luvstor.`,
      deepLink: '/(tabs)/token',
      data: {
        screen: 'token',
        code: 'REFERRAL_REWARD',
        amount: REFERRAL_REWARD_TOKENS,
        refereeId: String(refereeUser._id),
      },
    });
  } catch (e) {
    console.warn('referral notification failed', e?.message || e);
  }

  return {
    ok: true,
    tokensAwarded: REFERRAL_REWARD_TOKENS,
    referrerId: String(referrer._id),
    referrerBalance: updatedReferrer?.tokenBalance ?? null,
  };
}

async function getReferralDashboard(userId) {
  const user = await User.findById(userId).select(
    'referralCode publicId name tokenBalance',
  );
  if (!user) return null;
  const share = await referralShareUrlForUser(user);
  const code = share.referralCode;
  const { start, end } = monthRangeUtc();

  const [monthCount, totalCount, recent] = await Promise.all([
    Referral.countDocuments({
      referrerId: userId,
      status: 'rewarded',
      createdAt: { $gte: start, $lt: end },
    }),
    Referral.countDocuments({
      referrerId: userId,
      status: 'rewarded',
    }),
    Referral.find({ referrerId: userId, status: 'rewarded' })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('refereeId', 'name publicId photo createdAt')
      .lean(),
  ]);

  return {
    referralCode: code,
    shareUrl: share.shareUrl,
    playStoreUrl: share.playStoreUrl,
    slug: share.slug,
    rewardTokens: REFERRAL_REWARD_TOKENS,
    maxPerMonth: MAX_REFERRALS_PER_MONTH,
    referralsThisMonth: monthCount,
    referralsRemainingThisMonth: Math.max(0, MAX_REFERRALS_PER_MONTH - monthCount),
    totalReferrals: totalCount,
    totalTokensEarned: totalCount * REFERRAL_REWARD_TOKENS,
    referrals: recent.map((r) => ({
      id: String(r._id),
      name: r.refereeId?.name || 'Friend',
      publicId: r.refereeId?.publicId || '',
      photo: r.refereeId?.photo || '',
      tokensAwarded: r.tokensAwarded || REFERRAL_REWARD_TOKENS,
      at: r.createdAt,
    })),
  };
}

/** Parse Play Install Referrer / deep link for a referral code */
function extractReferralCodeFromReferrer(raw) {
  const s = String(raw || '');
  if (!s) return null;
  // utm_campaign=CODE or luvstor_ref=CODE or ref=CODE
  const m =
    s.match(/(?:utm_campaign|luvstor_ref|ref|referral)=([A-Za-z0-9]{4,12})/i) ||
    s.match(/(?:^|[?&#/])r\/([A-Za-z0-9]{4,12})/i) ||
    s.match(/^([A-Za-z0-9]{4,12})$/);
  return m ? normalizeReferralCode(m[1]) : null;
}

module.exports = {
  REFERRAL_REWARD_TOKENS,
  MAX_REFERRALS_PER_MONTH,
  normalizeReferralCode,
  ensureReferralCode,
  playStoreUrlForCode,
  referralHttpsUrl,
  referralShareUrlForUser,
  applyReferralOnSignup,
  getReferralDashboard,
  extractReferralCodeFromReferrer,
};
