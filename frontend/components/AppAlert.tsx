import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSheetBottomPadding } from "../utils/navigation";
import {
  sanitizeUserMessage,
  sanitizeUserTitle,
} from "../utils/userFacingError";
import { useStableBottomInset } from "../hooks/useStableBottomInset";
import { useTabBarOverlayInset } from "../hooks/useTabBarOverlayInset";
import { NAV_ICON } from "../utils/platformIcons";
import { themedPalette, themedStyles } from "../utils/theme";

export type AlertButtonStyle = "default" | "cancel" | "destructive" | "primary";

export type AlertButton = {
  text: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
  /** Ionicons name shown above label in horizontal layout */
  icon?: keyof typeof Ionicons.glyphMap;
};

export type AppAlertOptions = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  /** Kept for API compat — not shown */
  icon?: string;
  /**
   * `horizontal` — actions side-by-side in one card (default when exactly 2 buttons).
   * `vertical` — stacked list; Cancel stays on its own card below.
   */
  actionsLayout?: "vertical" | "horizontal";
};

type AppAlertContextValue = {
  showAlert: (options: AppAlertOptions) => void;
};

const AppAlertContext = createContext<AppAlertContextValue | null>(null);

/** Same look as the chat Block / Report sheets */
const C = themedPalette({
  accent: "#6750A4",
  danger: "#B3261E",
  title: "#1C1B1F",
  message: "#1C1B1F",
  divider: "#E7E0EC",
  sheet: "#F5F6F8",
  card: "#FFFFFF",
  closeBg: "#EADDFF",
  backdrop: "rgba(0, 0, 0, 0.5)",
});

const SHEET_HIDDEN_Y = 420;

function normalizeButtons(buttons?: AlertButton[]): AlertButton[] {
  if (buttons?.length) return buttons;
  return [{ text: "OK", style: "default" }];
}

function mapNativeButtons(
  buttons?: {
    text?: string;
    onPress?: () => void;
    style?: "default" | "cancel" | "destructive";
  }[],
): AlertButton[] | undefined {
  if (!buttons?.length) return undefined;
  return buttons.map((b) => ({
    text: b.text || "OK",
    style:
      b.style === "cancel"
        ? "cancel"
        : b.style === "destructive"
          ? "destructive"
          : "default",
    onPress: b.onPress,
  }));
}

function buttonColor(style?: AlertButtonStyle) {
  return style === "destructive" ? C.danger : C.accent;
}

/** Picks a fitting icon from the label when the caller didn't pass one. */
function defaultIcon(btn: AlertButton): keyof typeof Ionicons.glyphMap {
  if (btn.icon) return btn.icon;
  const t = btn.text.toLowerCase();
  if (/delete|remove|clear/.test(t)) return "trash-outline";
  if (/block/.test(t)) return "ban-outline";
  if (/report/.test(t)) return "warning-outline";
  if (/log ?out|sign ?out/.test(t)) return "log-out-outline";
  if (/setting/.test(t)) return "settings-outline";
  if (/retry|try again|refresh/.test(t)) return "refresh-outline";
  if (/buy|purchase|pay|upgrade|subscribe/.test(t)) return "diamond-outline";
  if (/share/.test(t)) return NAV_ICON.share;
  if (/call/.test(t)) return "call-outline";
  if (/camera/.test(t)) return "camera-outline";
  if (/gallery|photo|library/.test(t)) return "images-outline";
  if (/cancel|close|not now|later|no\b|keep/.test(t)) return "close-circle-outline";
  if (btn.style === "destructive") return "alert-circle-outline";
  return "checkmark-circle-outline";
}

/** Original system alert — use for Lucky Spin popups only. */
export const nativeAlert = Alert.alert.bind(Alert);

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const stableBottom = useStableBottomInset();
  const tabClearance = useTabBarOverlayInset();
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<AppAlertOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(SHEET_HIDDEN_Y)).current;
  const closingRef = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);

  const animateIn = useCallback(() => {
    opacity.setValue(0);
    slide.setValue(SHEET_HIDDEN_Y);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(slide, {
        toValue: 0,
        friction: 10,
        tension: 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, slide]);

  const animateOut = useCallback(
    (onDone?: () => void) => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: SHEET_HIDDEN_Y,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDone?.();
      });
    },
    [opacity, slide],
  );

  const showAlert = useCallback((opts: AppAlertOptions) => {
    // The sheet is pinned to the bottom of the root view, so an open keyboard would cover it.
    Keyboard.dismiss();
    closingRef.current = false;
    setOptions({
      ...opts,
      title: sanitizeUserTitle(opts.title),
      message: opts.message
        ? sanitizeUserMessage(opts.message)
        : undefined,
      buttons: normalizeButtons(opts.buttons),
    });
    setVisible(true);
  }, []);

  useEffect(() => {
    if (visible) animateIn();
  }, [visible, animateIn]);

  /** Route Alert.alert() through iOS-style UI — except spin screens use nativeAlert. */
  useEffect(() => {
    const original = nativeAlert;
    Alert.alert = (
      title: string,
      message?: string,
      buttons?: {
        text?: string;
        onPress?: () => void;
        style?: "default" | "cancel" | "destructive";
      }[],
    ) => {
      showAlert({
        title: String(title ?? ""),
        message: message ? String(message) : undefined,
        buttons: mapNativeButtons(buttons),
      });
    };
    return () => {
      Alert.alert = original;
    };
  }, [showAlert]);

  const finishClose = useCallback(() => {
    setVisible(false);
    setOptions(null);
    closingRef.current = false;
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) requestAnimationFrame(() => action());
  }, []);

  const close = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      pendingAction.current = after || null;
      animateOut(finishClose);
    },
    [animateOut, finishClose],
  );

  const buttons = options?.buttons || [];
  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const actionBtns = buttons.filter((b) => b.style !== "cancel");
  // Info alerts with only a cancel-styled "OK" still need one tappable row.
  const rows = actionBtns.length ? actionBtns : buttons;

  /** X / backdrop / back button: behaves like the Cancel button when there is one. */
  const dismiss = useCallback(() => {
    close(cancelBtn?.onPress);
  }, [close, cancelBtn]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, dismiss]);

  const handlePress = useCallback(
    (btn: AlertButton) => {
      close(() => btn.onPress?.());
    },
    [close],
  );

  const value = useMemo(() => ({ showAlert }), [showAlert]);

  // Sit just above footer tabs on tab screens; otherwise clear system nav
  const sheetBottomPad =
    tabClearance > 0 ? 14 : getSheetBottomPadding(stableBottom);

  return (
    <AppAlertContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {visible ? (
          <View
            style={styles.host}
            pointerEvents="box-none"
            accessibilityViewIsModal
          >
            <Animated.View
              style={[styles.dim, { bottom: tabClearance, opacity }]}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
            </Animated.View>

            <Animated.View
              style={[
                styles.sheet,
                {
                  bottom: tabClearance,
                  paddingBottom: sheetBottomPad,
                  transform: [{ translateY: slide }],
                },
              ]}
            >
              <View style={styles.header}>
                <Text style={styles.title} numberOfLines={3}>
                  {options?.title || ""}
                </Text>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={dismiss}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color={C.accent} />
                </TouchableOpacity>
              </View>

              {options?.message ? (
                <View style={styles.infoCard}>
                  <Text style={styles.infoText}>{options.message}</Text>
                </View>
              ) : null}

              <View style={styles.actionCard}>
                {rows.map((btn, i) => {
                  const color = buttonColor(btn.style);
                  return (
                    <React.Fragment key={`${btn.text}-${i}`}>
                      {i > 0 ? <View style={styles.actionDivider} /> : null}
                      <TouchableOpacity
                        style={styles.actionRow}
                        activeOpacity={0.55}
                        onPress={() => handlePress(btn)}
                        accessibilityRole="button"
                      >
                        <Ionicons name={defaultIcon(btn)} size={22} color={color} />
                        <Text style={[styles.actionText, { color }]}>
                          {btn.text}
                        </Text>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        ) : null}
      </View>
    </AppAlertContext.Provider>
  );
}

export function useAppAlert() {
  const ctx = useContext(AppAlertContext);
  if (!ctx) {
    throw new Error("useAppAlert must be used within AppAlertProvider");
  }
  return ctx;
}

const styles = themedStyles(() =>
  StyleSheet.create({
  root: {
    flex: 1,
  },
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
    elevation: 10000,
  },
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.backdrop,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    width: "100%",
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 10,
    zIndex: 1,
    elevation: 1,
  },
  header: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 44,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: C.title,
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute",
    right: 4,
    top: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.closeBg,
    alignItems: "center",
    justifyContent: "center",
  },
  infoCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.divider,
  },
  infoText: {
    fontSize: 15,
    lineHeight: 21,
    color: C.message,
  },
  actionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    overflow: "hidden",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
    marginLeft: 52,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
}),
);
