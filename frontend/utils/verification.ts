import { apiRequest } from './api';

export type PhotoVerification = {
  status: 'none' | 'pending' | 'approved' | 'rejected' | string;
  selfieUrl?: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  photoVerified?: boolean;
  message?: string;
};

export async function fetchPhotoVerification(token: string): Promise<PhotoVerification> {
  return apiRequest('/api/verification/me', token);
}

export async function submitPhotoVerification(
  token: string,
  selfieUrl: string,
): Promise<PhotoVerification> {
  return apiRequest('/api/verification/selfie', token, {
    method: 'POST',
    body: JSON.stringify({ selfieUrl }),
  });
}
