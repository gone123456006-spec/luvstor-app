/**
 * Module-level mirror of accessibility prefs for non-React callers
 * (haptics wrapper, global StyleSheet text patch). Kept in sync by
 * AccessibilityProvider — written synchronously before any re-render.
 */
export const a11yState = {
  haptics: true,
  boldAll: false,
};
