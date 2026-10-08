/**
 * Bio rules — mirror of backend/utils/bioFilter.js (server is the source of truth).
 *
 * Rejected: email addresses / mail providers, "luvstor", "@" handles,
 * social app names, username-like tokens, links.
 * Masked:   phone numbers keep the first 2 digits (98xxxxxxx).
 */

const EMAIL_RE =
  /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,})+/i;
const MAIL_PROVIDER_RE =
  /\b(?:g\s*-?\s*mail|gmail|ymail|yahoo|hotmail|outlook|proton\s*mail|icloud|rediff\s*mail|e-?mail(?:\s*id)?)\b/i;
const BRAND_RE = /l[\s._-]*u[\s._-]*v[\s._-]*s[\s._-]*t[\s._-]*o[\s._-]*r/i;
const HANDLE_SYMBOL_RE = /[@＠]/;
const SOCIAL_RE =
  /\b(?:insta(?:gram)?|ig|i\.g|snap(?:chat)?|sc|telegram|tg|whats\s*app|wa\.me|fb|facebook|twitter|tiktok|discord|kik|wechat|line\s*id|dm\s*me|follow\s*me)\b/i;
const USERNAME_RE =
  /(?:^|\s)(?=\S*_)(?=\S*[a-z])[a-z0-9._]{3,}|(?:^|\s)(?=[a-z0-9.]*\d)[a-z][a-z0-9]*(?:\.[a-z0-9]+)+/i;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|in|net|org|io|me|link|ly)\b/i;
const PHONE_RE = /\+?\d[\d\s\-().]{5,}\d/g;

export function maskPhones(text: string): string {
  return String(text).replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 7) return match;
    return `${digits.slice(0, 2)}${"x".repeat(digits.length - 2)}`;
  });
}

export type BioCheck = { ok: true; bio: string } | { ok: false; error: string };

export function checkBio(raw: string | null | undefined): BioCheck {
  const bio = String(raw ?? "").trim();
  if (!bio) return { ok: true, bio: "" };
  if (EMAIL_RE.test(bio) || MAIL_PROVIDER_RE.test(bio)) {
    return { ok: false, error: "Email addresses are not allowed in your bio." };
  }
  if (BRAND_RE.test(bio)) {
    return { ok: false, error: "Please don\u2019t use \"Luvstor\" in your bio." };
  }
  if (HANDLE_SYMBOL_RE.test(bio) || SOCIAL_RE.test(bio) || URL_RE.test(bio)) {
    return {
      ok: false,
      error: "Instagram / social usernames, @ handles and links are not allowed in your bio.",
    };
  }
  if (USERNAME_RE.test(bio)) {
    return { ok: false, error: "Usernames are not allowed in your bio." };
  }
  return { ok: true, bio: maskPhones(bio) };
}
