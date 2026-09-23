/**
 * Production user copy — Instagram / WhatsApp style.
 * Never show hosts, stack traces, Expo, npm, or API internals.
 */

const GENERIC = "Something went wrong. Please try again.";
const OFFLINE = "Couldn't connect. Check your internet and try again.";
const BUSY = "We're a bit busy. Please try again in a moment.";
const SIGN_IN = "Please sign in to continue.";
const TOO_FAST = "That's a little too fast. Wait a moment and try again.";
const NOT_FOUND = "We couldn't find that.";
const FORBIDDEN = "You can't do that right now.";
const UPLOAD = "Couldn't upload your photo. Please try again.";
const VERIFY = "Couldn't complete photo verification. Please try again.";

const CODE_MESSAGE: Record<string, string> = {
  SELFIE_OWNERSHIP: "Use a live selfie taken in the app.",
  CHALLENGE: "That step expired. Please try again.",
  NO_PROFILE_PHOTO: "Add a clear profile photo first, then try again.",
  RATE_LIMIT: "Too many tries today. Come back tomorrow.",
  DEVICE_MISMATCH: "This account is already in use on another device.",
  DEVICE_IN_USE: "This account is already in use on another device.",
  INVALID_OTP: "That code didn't work. Try again.",
  OTP_EXPIRED: "That code expired. Request a new one.",
  OTP_MAX_ATTEMPTS: "Too many attempts. Request a new code.",
  INSUFFICIENT_TOKENS: "You don't have enough tokens for this.",
  DOWNGRADE_BLOCKED: "You already have a higher plan active.",
  INVALID_PLAN: "That plan isn't available.",
  PAYMENT_INCOMPLETE: "Payment didn't finish. You haven't been charged.",
  INVALID_SIGNATURE: "Payment couldn't be confirmed. Try again.",
  SPIN_LIMIT_REACHED: "No spins left. Come back later.",
  PACK_MISMATCH: "That purchase couldn't be confirmed.",
  AMOUNT_MISMATCH: "That purchase couldn't be confirmed.",
};

const LEAK =
  /https?:\/\/|www\.|luvstor-api|onrender|localhost|127\.0\.0\.1|10\.0\.2\.2|172\.\d+\.|192\.168\.|:\d{2,5}\b|\/api\/|\/uploads\/|file:\/\/|content:\/\/|exp\+|expo[-\s]?go|metro|npm |npx |node_modules|econnrefused|enotfound|aborterror|etimedout|typeerror|referenceerror|syntaxerror|stack:|at \w+\s*\(|webpack|hermes|render\.com|mongodb|mongoose|smtp|brevo|razorpay|json_body|selfieurl|challengeToken|failed to fetch|network request failed|status code|\(\d{3}\)|errno/i;

function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return String(value.message || "").trim();
  if (typeof value === "object") {
    const o = value as { message?: unknown; error?: unknown; description?: unknown };
    return String(o.message || o.error || o.description || "").trim();
  }
  return String(value).trim();
}

function looksSafe(text: string): boolean {
  if (!text || text.length > 160) return false;
  if (LEAK.test(text)) return false;
  if (/[{}=<>]/.test(text)) return false;
  if (/\b(backend|frontend|server|database|exception|traceback|stack trace)\b/i.test(text)) {
    return false;
  }
  return true;
}

function byStatus(status?: number): string {
  if (!status) return GENERIC;
  if (status === 401) return SIGN_IN;
  if (status === 403) return FORBIDDEN;
  if (status === 404) return NOT_FOUND;
  if (status === 408 || status === 504) return OFFLINE;
  if (status === 429) return TOO_FAST;
  if (status >= 500) return BUSY;
  return GENERIC;
}

function byKeywords(text: string): string | null {
  const t = text.toLowerCase();
  if (
    /timeout|timed out|took too long|network|offline|failed to fetch|cannot reach|couldn't connect|could not connect|connection/i.test(
      t,
    )
  ) {
    return OFFLINE;
  }
  if (/upload|image-bin|multipart/i.test(t)) return UPLOAD;
  if (/verif|selfie|challenge|pose/i.test(t)) return VERIFY;
  if (/camera|permission|capture/i.test(t)) {
    return "We couldn't open the camera. Check permissions and try again.";
  }
  if (/token|wallet|spin/i.test(t) && /insufficient|not enough|balance/i.test(t)) {
    return CODE_MESSAGE.INSUFFICIENT_TOKENS;
  }
  if (/payment|razorpay|purchase/i.test(t)) {
    return "Payment didn't go through. You haven't been charged. Try again.";
  }
  if (/otp|verification code|email login|smtp|brevo/i.test(t)) {
    return "We couldn't send a code right now. Try Google login, or try again later.";
  }
  return null;
}

/** Short, production-safe copy for any thrown/server/native string. */
export function sanitizeUserMessage(raw: unknown, fallback: string = GENERIC): string {
  const text = asText(raw);
  if (!text) return fallback;

  const fromWords = byKeywords(text);
  if (fromWords) return fromWords;

  if (looksSafe(text)) return text;
  return fallback;
}

/** Safe alert title — never a URL or stack fragment. */
export function sanitizeUserTitle(raw: unknown, fallback = "Something went wrong"): string {
  const text = asText(raw);
  if (!text) return fallback;
  if (looksSafe(text) && text.length <= 48) return text;
  return fallback;
}

export function userFacingMessage(err: unknown, fallback: string = GENERIC): string {
  const anyErr = err as {
    code?: string;
    status?: number;
    message?: string;
    error?: string;
  } | null;
  const code = String(anyErr?.code || "").trim();
  if (code && CODE_MESSAGE[code]) return CODE_MESSAGE[code];

  const status = Number(anyErr?.status) || 0;
  const raw = asText(err);
  const fromWords = byKeywords(raw);
  if (fromWords) return fromWords;
  if (looksSafe(raw)) return raw;
  if (status) return byStatus(status);
  return fallback;
}

export const USER_ERROR = {
  generic: GENERIC,
  offline: OFFLINE,
  busy: BUSY,
  signIn: SIGN_IN,
  upload: UPLOAD,
  verify: VERIFY,
};
