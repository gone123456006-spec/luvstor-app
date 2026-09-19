import { useSegments } from "expo-router";
import { getTabBarHeight } from "../utils/navigation";
import { useStableBottomInset } from "./useStableBottomInset";

/**
 * Bottom clearance so in-tree popups sit just above the footer tabs.
 * Returns 0 outside `(tabs)`.
 *
 * Use on hosts that cover the full window (not inside a bottom SafeAreaView).
 */
export function useTabBarOverlayInset(): number {
  const segments = useSegments();
  const bottom = useStableBottomInset();
  const onTabs = segments[0] === "(tabs)";
  if (!onTabs) return 0;
  return getTabBarHeight(bottom);
}
