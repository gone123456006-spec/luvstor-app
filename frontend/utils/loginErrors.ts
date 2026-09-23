import { ApiError } from './api';
import { userFacingMessage } from './userFacingError';

const GOOGLE_HINT = 'You can also try Log in with Google.';

/**
 * Maps email/OTP login failures to short, production-safe copy.
 */
export function emailLoginErrorMessage(err: unknown, fallback?: string): string {
  const apiErr = err instanceof ApiError ? err : null;
  const status = apiErr?.status ?? 0;
  const code = String(apiErr?.code || '');

  if (
    code === 'DEVICE_IN_USE' ||
    code === 'DEVICE_MISMATCH' ||
    code === 'INVALID_OTP' ||
    code === 'OTP_EXPIRED' ||
    code === 'OTP_MAX_ATTEMPTS'
  ) {
    return userFacingMessage(err);
  }

  const safe = userFacingMessage(err, fallback || 'Something went wrong. Please try again.');

  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return safe;
  }

  if (
    status >= 500 ||
    status === 429 ||
    status === 408 ||
    status === 0 ||
    /connect|internet|busy|code|google/i.test(safe)
  ) {
    if (/google/i.test(safe)) return safe;
    return `${safe} ${GOOGLE_HINT}`;
  }

  return `${safe} ${GOOGLE_HINT}`;
}
