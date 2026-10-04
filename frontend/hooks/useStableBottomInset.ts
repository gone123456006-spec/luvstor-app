import { useEffect, useState } from "react";
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/** A 0 inset that lasts this long is real (system bar doesn't overlap the app). */
const ZERO_SETTLE_MS = 400;

/**
 * WhatsApp-style: keep a stable system-nav bottom inset.
 *
 * Opening translucent Modals / KeyboardProvider often flashes `insets.bottom`
 * to 0, which makes an absolute tab bar jump ("teleport"). Brief zero flashes
 * are ignored; a zero that persists is accepted, so devices whose nav bar sits
 * outside the app window don't get a phantom gap.
 */
export function useStableBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  const [latched, setLatched] = useState(
    () => bottom || initialWindowMetrics?.insets?.bottom || 0,
  );

  if (bottom > 0 && bottom !== latched) setLatched(bottom);

  useEffect(() => {
    if (bottom > 0) return;
    const t = setTimeout(() => setLatched(0), ZERO_SETTLE_MS);
    return () => clearTimeout(t);
  }, [bottom]);

  return bottom > 0 ? bottom : latched;
}
