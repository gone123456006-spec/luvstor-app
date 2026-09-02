/** Google OAuth client IDs for expo-auth-session (no Firebase JS SDK needed). */
export const googleOAuthConfig = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
};

export function isGoogleAuthConfigured(): boolean {
  return Boolean(googleOAuthConfig.webClientId);
}

export function getGoogleAuthConfigHint(): string {
  if (!googleOAuthConfig.webClientId) {
    return 'Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in frontend/.env';
  }
  return 'Google Sign-In config looks ready';
}
