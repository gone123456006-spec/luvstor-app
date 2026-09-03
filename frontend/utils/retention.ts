import { apiRequest } from './api';

export type StreakInfo = {
  openStreakDays: number;
  lastOpenDate?: string | null;
  spinStreakDays: number;
  canSpinToday?: boolean;
  spinsRemaining?: number;
  today?: string;
  alreadyCountedToday?: boolean;
  streakContinued?: boolean;
};

export async function pingAppOpen(token: string): Promise<StreakInfo> {
  return apiRequest('/api/retention/open', token, { method: 'POST', body: '{}' });
}

export async function fetchStreak(token: string): Promise<StreakInfo> {
  return apiRequest('/api/retention/streak', token);
}
