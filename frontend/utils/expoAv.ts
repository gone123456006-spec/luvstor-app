/**
 * Safe expo-av loader.
 * Importing `expo-av` throws when native ExponentAV is missing (wrong Expo Go /
 * needs a rebuilt native app). That used to crash the whole root layout and
 * surface as expo-router "ErrorBoundary of undefined".
 */
import type { Audio as ExpoAudioNamespace } from 'expo-av';

type AudioApi = typeof ExpoAudioNamespace;

let Audio: AudioApi | null = null;
let loadError: string | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Audio = require('expo-av').Audio as AudioApi;
} catch (err) {
  loadError = err instanceof Error ? err.message : String(err);
  console.warn('[expo-av] unavailable:', loadError);
}

export { Audio };

export function isAudioAvailable(): boolean {
  return Audio != null;
}

export function getAudio(): AudioApi {
  if (!Audio) {
    throw new Error(
      loadError ||
        'expo-av native module (ExponentAV) is missing. Rebuild the app with `npx expo run:android` or install SDK 57 Expo Go from sign.expo.dev.',
    );
  }
  return Audio;
}
