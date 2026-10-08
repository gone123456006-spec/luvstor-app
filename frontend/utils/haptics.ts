import * as H from "expo-haptics";
import { a11yState } from "./a11yState";

/** Drop-in for `expo-haptics` that respects Settings → Accessibility → Haptic feedback. */
export const ImpactFeedbackStyle = H.ImpactFeedbackStyle;
export const NotificationFeedbackType = H.NotificationFeedbackType;

export function impactAsync(style?: H.ImpactFeedbackStyle): Promise<void> {
  return a11yState.haptics ? H.impactAsync(style) : Promise.resolve();
}

export function notificationAsync(
  type?: H.NotificationFeedbackType,
): Promise<void> {
  return a11yState.haptics ? H.notificationAsync(type) : Promise.resolve();
}

export function selectionAsync(): Promise<void> {
  return a11yState.haptics ? H.selectionAsync() : Promise.resolve();
}
