/**
 * Production share URLs for Refer + profile.
 *
 * Default (works now): https://luvstor-api.onrender.com/go/{slug}
 * Optional branded host (OneLink / custom domain) only when
 * PUBLIC_SHARE_EXTERNAL_READY=1 and PUBLIC_SHARE_BASE_URL is set.
 */
const crypto = require('crypto');
const ShortLink = require('../models/ShortLink');

const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function getApiPublicBase() {
  return (
    process.env.PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    'https://luvstor-api.onrender.com'
  ).replace(/\/$/, '');
}

function getShareBase() {
  return (
    process.env.PUBLIC_SHARE_BASE_URL ||
    getApiPublicBase()
  ).replace(/\/$/, '');
}

function getOnelinkTemplatePath() {
  return (
    String(process.env.ONELINK_TEMPLATE_PATH || 'luvstor')
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase() || 'luvstor'
  );
}

function externalShareReady() {
  return String(process.env.PUBLIC_SHARE_EXTERNAL_READY || '') === '1';
}

function looksLikeUnverifiedShortener(base) {
  return /onelink\.me|appsflyer\.com/i.test(String(base || ''));
}

/** Working bounce URL on our API (always valid once deployed). */
function buildResolveUrl(slug) {
  const s = String(slug || '').trim().toUpperCase();
  if (!s) return null;
  return `${getApiPublicBase()}/go/${s}`;
}

/**
 * URL users copy / share.
 * Uses API /go/:slug until OneLink/custom domain is confirmed ready.
 */
function buildBrandedShareUrl(slug) {
  const s = String(slug || '').trim().toUpperCase();
  if (!s) return null;

  const resolve = buildResolveUrl(s);
  const base = getShareBase();

  // OneLink without AppsFlyer config → broken links. Prefer working API URL.
  if (!externalShareReady() || looksLikeUnverifiedShortener(base)) {
    return resolve;
  }

  // Custom domain or verified OneLink template path
  if (base === getApiPublicBase() || /onrender\.com$/i.test(base.replace(/^https?:\/\//, '').split('/')[0])) {
    return `${base}/go/${s}`;
  }

  const tpl = getOnelinkTemplatePath();
  return `${base}/${tpl}/${s}`;
}

function generateSlugCandidate(len = 8) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SLUG_ALPHABET[crypto.randomInt(0, SLUG_ALPHABET.length)];
  }
  return out;
}

async function allocateUniqueSlug() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const slug = generateSlugCandidate(8);
    const taken = await ShortLink.exists({ slug });
    if (!taken) return slug;
  }
  throw new Error('Could not allocate share slug');
}

async function ensureReferralShareLink({ referralCode, ownerUserId }) {
  const code = String(referralCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!code || code.length < 4) return null;

  let row = await ShortLink.findOne({ type: 'referral', referralCode: code });
  if (!row) {
    try {
      row = await ShortLink.create({
        slug: await allocateUniqueSlug(),
        type: 'referral',
        referralCode: code,
        ownerUserId: ownerUserId || null,
      });
    } catch (err) {
      if (err?.code === 11000) {
        row = await ShortLink.findOne({ type: 'referral', referralCode: code });
      } else {
        throw err;
      }
    }
  }
  if (!row) return null;

  return {
    slug: row.slug,
    shareUrl: buildBrandedShareUrl(row.slug),
    resolveUrl: buildResolveUrl(row.slug),
    type: 'referral',
    referralCode: code,
  };
}

async function ensureProfileShareLink({ publicId, ownerUserId }) {
  const id = String(publicId || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{4}\d{4}$/.test(id)) return null;

  let row = await ShortLink.findOne({ type: 'profile', publicId: id });
  if (!row) {
    try {
      row = await ShortLink.create({
        slug: await allocateUniqueSlug(),
        type: 'profile',
        publicId: id,
        ownerUserId: ownerUserId || null,
      });
    } catch (err) {
      if (err?.code === 11000) {
        row = await ShortLink.findOne({ type: 'profile', publicId: id });
      } else {
        throw err;
      }
    }
  }
  if (!row) return null;

  return {
    slug: row.slug,
    shareUrl: buildBrandedShareUrl(row.slug),
    resolveUrl: buildResolveUrl(row.slug),
    type: 'profile',
    publicId: id,
  };
}

async function findBySlug(slug) {
  const s = String(slug || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!s || s.length < 4) return null;
  return ShortLink.findOne({ slug: s });
}

async function recordClick(slug) {
  const s = String(slug || '').trim().toUpperCase();
  if (!s) return;
  await ShortLink.updateOne({ slug: s }, { $inc: { clickCount: 1 } }).catch(
    () => {},
  );
}

module.exports = {
  getShareBase,
  getOnelinkTemplatePath,
  getApiPublicBase,
  buildBrandedShareUrl,
  buildResolveUrl,
  ensureReferralShareLink,
  ensureProfileShareLink,
  findBySlug,
  recordClick,
};
