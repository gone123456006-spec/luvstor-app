import { apiRequest } from './api';

export type PhotoVerification = {
  status: 'none' | 'pending' | 'approved' | 'rejected' | string;
  selfieUrl?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  pose?: string;
  matchScore?: number | null;
  photoVerified?: boolean;
  message?: string;
  decision?: 'approve' | 'reject' | 'pending' | string;
  canRetry?: boolean;
  verificationTokensGranted?: number;
  tokenBalance?: number;
  analysisInMs?: number;
  autoApproveInMs?: number;
  analysisDueAt?: string | null;
};

export type PhotoChallenge = {
  pose: string;
  label: string;
  instruction: string;
  challengeToken: string;
  expiresAt: string;
  expiresInMs?: number;
  alreadyVerified?: boolean;
  photoVerified?: boolean;
  status?: string;
};

export async function fetchPhotoVerification(token: string): Promise<PhotoVerification> {
  return apiRequest('/api/verification/me', token);
}

export async function fetchPhotoChallenge(token: string): Promise<PhotoChallenge> {
  return apiRequest('/api/verification/challenge', token);
}

export async function submitPhotoVerification(
  token: string,
  selfieUrl: string,
  opts: { pose: string; challengeToken: string },
): Promise<PhotoVerification> {
  return apiRequest('/api/verification/selfie', token, {
    method: 'POST',
    body: JSON.stringify({
      selfieUrl,
      pose: opts.pose,
      challengeToken: opts.challengeToken,
    }),
  });
}
