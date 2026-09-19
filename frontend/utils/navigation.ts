/**
 * Shared navigation transition presets — hardware-accelerated (opacity/transform via native stack).
 * Target: 260 ms ease-out slide, no white flashes, previous screen frozen until transition ends.
 */
import { Platform } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

export const SCREEN_BG = '#F5F5F7';

/** Icon + label row height (above system nav inset) */
export const TAB_BAR_CONTENT_HEIGHT = 58;

/** Extra gap so screen content sits clearly above the absolute tab bar */
export const TAB_BAR_CONTENT_GAP = 18;

/**
 * Previous hard-coded Explore padding floors.
 * Keep these as a minimum so low/zero safe-area insets cannot under-pad
 * content beneath the absolute tab bar (regression from 108 / 96).
 */
const TAB_BAR_CLEARANCE_FLOOR = Platform.OS === 'ios' ? 108 : 96;

/** Boot-time bottom inset — survives Modal inset flashes to 0 */
const BOOT_BOTTOM_INSET = initialWindowMetrics?.insets?.bottom ?? 0;

export function getTabBarBottomInset(safeBottom: number): number {
  const resolved = Math.max(safeBottom, BOOT_BOTTOM_INSET);
  return Math.max(resolved, Platform.OS === 'android' ? 12 : 8);
}

/** Full tab bar height for style.height */
export function getTabBarHeight(safeBottom: number): number {
  return TAB_BAR_CONTENT_HEIGHT + getTabBarBottomInset(safeBottom);
}

/** Bottom padding for tab screens so content is not hidden under the tab bar */
export function getTabBarClearance(safeBottom: number): number {
  const dynamic = getTabBarHeight(safeBottom) + TAB_BAR_CONTENT_GAP;
  return Math.max(dynamic, TAB_BAR_CLEARANCE_FLOOR);
}

/**
 * Bottom padding for action sheets / alerts so Cancel and actions clear
 * the Android 3-button nav (≈48dp) or iOS home indicator.
 * Floors low/zero insets (common inside translucent Modals).
 */
export function getSheetBottomPadding(safeBottom: number): number {
  const floor = Platform.OS === 'android' ? 48 : 20;
  return Math.max(safeBottom, BOOT_BOTTOM_INSET, floor) + 12;
}

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
  tabBarHideOnKeyboard: false,
  sceneStyle: { backgroundColor: SCREEN_BG },
};
