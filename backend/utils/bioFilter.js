/**
 * Bio rules — keep contact details off public profiles.
 *
 * Rejected: email addresses / mail providers, the word "luvstor",
 * "@" handles, social app names (insta, snap, telegram…), username-like tokens.
 * Masked:   phone numbers keep the first 2 digits, rest become x (98xxxxxxx).
 *
 * Keep in sync with frontend/utils/bioFilter.ts.
 */

const EMAIL_RE =
  /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,})+/i;
const MAIL_PROVIDER_RE =
  /\b(?:g\s*-?\s*mail|gmail|ymail|yahoo|hotmail|outlook|proton\s*mail|icloud|rediff\s*mail|e-?mail(?:\s*id)?)\b/i;
const BRAND_RE = /l[\s._-]*u[\s._-]*v[\s._-]*s[\s._-]*t[\s._-]*o[\s._-]*r/i;
const HANDLE_SYMBOL_RE = /[@＠]/;
const SOCIAL_RE =
  /\b(?:insta(?:gram)?|ig|i\.g|snap(?:chat)?|sc|telegram|tg|whats\s*app|wa\.me|fb|facebook|twitter|tiktok|discord|kik|wechat|line\s*id|dm\s*me|follow\s*me)\b/i;
/** john_doe, john.doe12 — handle-shaped tokens (not "e.g.", "a.m." or "sunsets.Beach") */
const USERNAME_RE =
  /(?:^|\s)(?=\S*_)(?=\S*[a-z])[a-z0-9._]{3,}|(?:^|\s)(?=[a-z0-9.]*\d)[a-z][a-z0-9]*(?:\.[a-z0-9]+)+/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|in|net|org|io|me|link|ly)\b/i;

/** Runs of 7+ digits, allowing spaces / dashes / dots / brackets / leading + */
const PHONE_RE = /\+?\d[\d\s\-().]{5,}\d/g;

function maskPhones(text) {
  return String(text).replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7) return match;
    return `${digits.slice(0, 2)}${'x'.repeat(digits.length - 2)}`;
  });
}

/**
 * @returns {{ ok: true, bio: string } | { ok: false, error: string, code: string }}
 */
function checkBio(raw) {
  const bio = String(raw ?? '').trim();
  if (!bio) return { ok: true, bio: '' };

  if (EMAIL_RE.test(bio) || MAIL_PROVIDER_RE.test(bio)) {
    return { ok: false, code: 'BIO_EMAIL', error: 'Email addresses are not allowed in your bio.' };
  }
  if (BRAND_RE.test(bio)) {
    return { ok: false, code: 'BIO_BRAND', error: 'Please don\u2019t use "Luvstor" in your bio.' };
  }
  if (HANDLE_SYMBOL_RE.test(bio) || SOCIAL_RE.test(bio) || URL_RE.test(bio)) {
    return {
      ok: false,
      code: 'BIO_SOCIAL',
      error: 'Instagram / social usernames, @ handles and links are not allowed in your bio.',
    };
  }
  if (USERNAME_RE.test(bio)) {
    return { ok: false, code: 'BIO_USERNAME', error: 'Usernames are not allowed in your bio.' };
  }
  return { ok: true, bio: maskPhones(bio) };
}

/** For display of older bios saved before the rules: never throws, never rejects */
function sanitizeBioForDisplay(raw) {
  const bio = String(raw ?? '');
  if (!bio) return bio;
  const res = checkBio(bio);
  if (res.ok) return res.bio;
  return '';
}

module.exports = { checkBio, maskPhones, sanitizeBioForDisplay };
