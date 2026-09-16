import { apiRequest } from './api';
import { getOrCreateDeviceId } from './device';

export type ReferralDashboard = {
  referralCode: string;
  shareUrl: string;
  playStoreUrl: string;
  rewardTokens: number;
  maxPerMonth: number;
  referralsThisMonth: number;
  referralsRemainingThisMonth: number;
  totalReferrals: number;
  totalTokensEarned: number;
  referrals: Array<{
    id: string;
    name: string;
    publicId: string;
    photo: string;
    tokensAwarded: number;
    at: string;
  }>;
};

export async function fetchReferralDashboard(
  token: string,
): Promise<ReferralDashboard> {
  return apiRequest('/api/referrals/me', token) as Promise<ReferralDashboard>;
}

export async function claimReferral(
  token: string,
  referralCode: string,
): Promise<{ success: boolean; ok?: boolean; reason?: string }> {
  const deviceId = await getOrCreateDeviceId();
  return apiRequest('/api/referrals/claim', token, {
    method: 'POST',
    body: JSON.stringify({ referralCode, deviceId }),
  }) as Promise<{ success: boolean; ok?: boolean; reason?: string }>;
}

export function buildReferralShareMessage(opts: {
  shareUrl: string;
  rewardTokens: number;
  name?: string;
}): string {
  const who = opts.name?.trim() ? opts.name.trim() : 'your friend';
  return (
    `Hey! Join me on Luvstor 💜\n\n` +
    `Download the app from Play Store and complete login with my invite link.\n` +
    `${who} gets ${opts.rewardTokens} tokens when you sign up.\n\n` +
    `${opts.shareUrl}`
  );
}
