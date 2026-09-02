/**
 * Shared navigation transition presets — hardware-accelerated (opacity/transform via native stack).
 * Target: 260 ms ease-out slide, no white flashes, previous screen frozen until transition ends.
 */

export const SCREEN_BG = '#FFFFFF';

/** Primary push navigation (chat, settings, profile sub-screens) */
export const stackScreenOptions = {
  headerShown: false,
  animation: 'slide_from_right' as const,
  animationDuration: 260,
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
  freezeOnBlur: true,
  contentStyle: { backgroundColor: SCREEN_BG },
};

/** Soft cross-fade (auth completion, tab root entry) */
export const fadeScreenOptions = {
  ...stackScreenOptions,
  animation: 'fade' as const,
  animationDuration: 220,
};

/** Instant swap (redirect gates, replace navigation) */
export const instantScreenOptions = {
  ...stackScreenOptions,
  animation: 'none' as const,
  animationDuration: 0,
};

/** Modal-style sheets */
export const modalScreenOptions = {
  ...stackScreenOptions,
  presentation: 'modal' as const,
  animation: 'slide_from_bottom' as const,
  animationDuration: 280,
};

/** Multi-step wizard (delete account flow) */
export const wizardScreenOptions = {
  ...stackScreenOptions,
  animation: 'fade' as const,
  animationDuration: 240,
};

/** Bottom tabs — keep screens alive like WhatsApp, no freeze/reload on return */
export const tabScreenOptions = {
  headerShown: false,
  lazy: false,
  freezeOnBlur: false,
  tabBarHideOnKeyboard: true,
  sceneStyle: { backgroundColor: SCREEN_BG },
};
