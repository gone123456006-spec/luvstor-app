import { ApiError } from './api';

const GOOGLE_HINT =
  'Please try Log in with Google.';

/**
 * Maps email/OTP login failures to a clear message.
 * Server overload / network / 5xx / 429 → suggest Google login.
 * Validation / wrong OTP / device conflicts keep their own message.
 */
export function emailLoginErrorMessage(err: unknown, fallback?: string): string {
  const apiErr = err instanceof ApiError ? err : null;
  const status = apiErr?.status ?? 0;
  const code = String(apiErr?.code || '');
  const raw =
    (err instanceof Error && err.message) ||
    fallback ||
    'Something went wrong.';

  if (
    code === 'DEVICE_IN_USE' ||
    code === 'DEVICE_MISMATCH' ||
    code === 'INVALID_OTP' ||
    code === 'OTP_EXPIRED' ||
    code === 'OTP_MAX_ATTEMPTS'
  ) {
    return raw;
  }

  // Client validation / bad request — keep server text
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return raw;
  }

  const lower = raw.toLowerCase();

  // Email transport misconfig on Render — don't hide behind "high demand"
  if (
    /brevo|smtp|email blocked|email is not configured|cannot reach smtp|verification email/i.test(
      lower,
    )
  ) {
    return (
      'Email OTP is not available right now (mail service not configured on the server). ' +
      GOOGLE_HINT
    );
  }

  const looksLikeServerOrNetwork =
    status >= 500 ||
    status === 429 ||
    status === 408 ||
    /network|timeout|timed out|failed to fetch|fetch failed|econnrefused|unavailable|high demand|too many|server error|overload|gateway|bad gateway|service unavailable|internal server|connection|took too long/i.test(
      lower,
    ) ||
    status === 0;

  if (looksLikeServerOrNetwork) {
    return `Email login is temporarily unavailable due to high demand or a server issue. ${GOOGLE_HINT}`;
  }

  return `${raw} ${GOOGLE_HINT}`;
}
