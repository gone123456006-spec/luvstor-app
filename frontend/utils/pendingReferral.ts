import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_REFERRAL_KEY = 'luvstor_pending_referral_code';
const REFERRER_CAPTURED_KEY = 'luvstor_install_referrer_captured';

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return code.length >= 4 ? code : null;
}

export function extractReferralCodeFromString(raw: string | null | undefined): string | null {
  const s = String(raw || '');
  if (!s) return null;
  const m =
    s.match(/(?:utm_campaign|luvstor_ref|ref|referral)=([A-Za-z0-9]{4,12})/i) ||
    s.match(/(?:^|[?&#/])r\/([A-Za-z0-9]{4,12})/i) ||
    s.match(/^([A-Za-z0-9]{4,12})$/);
  return m ? normalizeReferralCode(m[1]) : null;
}

export async function setPendingReferralCode(code: string | null) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) {
    await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_REFERRAL_KEY, normalized);
}

export async function peekPendingReferralCode(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_REFERRAL_KEY);
  return normalizeReferralCode(raw);
}

export async function consumePendingReferralCode(): Promise<string | null> {
  const code = await peekPendingReferralCode();
  await AsyncStorage.removeItem(PENDING_REFERRAL_KEY);
  return code;
}

/**
 * Capture Play Store install referrer once (production Android).
 * Share links use utm_campaign=CODE so friends who install via Play are attributed.
 */
export async function captureInstallReferrerOnce(): Promise<string | null> {
  try {
    const done = await AsyncStorage.getItem(REFERRER_CAPTURED_KEY);
    if (done === '1') return peekPendingReferralCode();

    let referrer = '';
    try {
      const Application = await import('expo-application');
      if (typeof Application.getInstallReferrerAsync === 'function') {
        referrer = (await Application.getInstallReferrerAsync()) || '';
      }
    } catch {
      /* expo-application unavailable in some environments */
    }

    await AsyncStorage.setItem(REFERRER_CAPTURED_KEY, '1');
    const code = extractReferralCodeFromString(referrer);
    if (code) {
      const existing = await peekPendingReferralCode();
      if (!existing) await setPendingReferralCode(code);
      return code;
    }
  } catch {
    try {
      await AsyncStorage.setItem(REFERRER_CAPTURED_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  return peekPendingReferralCode();
}
