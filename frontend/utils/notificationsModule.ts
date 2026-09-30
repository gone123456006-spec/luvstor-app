/**
 * Expo Go (SDK 53+) throws if expo-notifications is even imported on Android,
 * so every caller must go through this lazy loader instead of a static import.
 */
import { isRunningInExpoGo } from 'expo';

export const isExpoGo = isRunningInExpoGo();

export type NotificationsModule = typeof import('expo-notifications');

let notificationsModule: NotificationsModule | null | undefined;

export function loadNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notificationsModule = require('expo-notifications') as NotificationsModule;
  } catch (err: any) {
    console.warn('[Push] expo-notifications unavailable:', err?.message);
    notificationsModule = null;
  }
  return notificationsModule;
}
