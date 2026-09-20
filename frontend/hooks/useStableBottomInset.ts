import { useRef } from "react";
import { Platform } from "react-native";
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

const BOOT_BOTTOM =
  initialWindowMetrics?.insets?.bottom ??
  (Platform.OS === "android" ? 48 : 34);

/**
 * WhatsApp-style: keep a stable system-nav bottom inset.
 *
 * Opening translucent Modals / KeyboardProvider often flashes `insets.bottom`
 * to 0, which makes an absolute tab bar jump ("teleport"). Ignore zero flashes
 * and only accept real non-zero updates (e.g. gesture ↔ 3-button nav).
 */
export function useStableBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  const latched = useRef(Math.max(BOOT_BOTTOM, bottom));

  if (bottom > 0) {
    latched.current = bottom;
  }

  return bottom > 0 ? bottom : latched.current;
}
