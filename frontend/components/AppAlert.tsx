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

/** iOS-style action sheet colors */
const C = {
  accent: "#007AFF",
  danger: "#FF3B30",
  title: "#000000",
  message: "#3C3C43",
  divider: "rgba(60, 60, 67, 0.29)",
  card: "#E4E6EB",
  backdrop: "rgba(0, 0, 0, 0.55)",
};

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

function buttonTextStyle(style?: AlertButtonStyle) {
  if (style === "destructive") return styles.sheetBtnDanger;
  if (style === "cancel") return styles.sheetCancelText;
  return styles.sheetBtnText;
}

function buttonIconColor(style?: AlertButtonStyle) {
  if (style === "destructive") return C.danger;
  return C.accent;
}

function renderActionLabel(btn: AlertButton, horizontal?: boolean) {
  const color = buttonIconColor(btn.style);
  if (horizontal && btn.icon) {
    return (
      <View style={styles.sheetRowBtnContent}>
        <Ionicons name={btn.icon} size={20} color={color} />
        <Text style={[buttonTextStyle(btn.style), styles.sheetRowBtnLabel]}>
          {btn.text}
        </Text>
      </View>
    );
  }
  return <Text style={buttonTextStyle(btn.style)}>{btn.text}</Text>;
}

/** Original system alert — use for Lucky Spin popups only. */
export const nativeAlert = Alert.alert.bind(Alert);

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const stableBottom = useStableBottomInset();
  const tabClearance = useTabBarOverlayInset();
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<AppAlertOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(48)).current;
  const closingRef = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);

  const animateIn = useCallback(() => {
    opacity.setValue(0);
    slide.setValue(48);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(slide, {
        toValue: 0,
        friction: 9,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, slide]);

  const animateOut = useCallback(
    (onDone?: () => void) => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(slide, {
          toValue: 40,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) onDone?.();
      });
    },
    [opacity, slide],
  );

  const showAlert = useCallback((opts: AppAlertOptions) => {
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

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);

  const handlePress = useCallback(
    (btn: AlertButton) => {
      close(() => btn.onPress?.());
    },
    [close],
  );

  const value = useMemo(() => ({ showAlert }), [showAlert]);

  const buttons = options?.buttons || [];
  const cancelBtn = buttons.find((b) => b.style === "cancel");
  const actionBtns = buttons.filter((b) => b.style !== "cancel");

  const iosActions = [...actionBtns].sort((a, b) => {
    const rank = (s?: AlertButtonStyle) =>
      s === "destructive" ? 0 : s === "primary" || s === "default" ? 1 : 2;
    return rank(a.style) - rank(b.style);
  });

  // Two-option alerts → one row: [action | Cancel]. Explicit vertical opts out.
  const isHorizontal =
    options?.actionsLayout === "horizontal" ||
    (options?.actionsLayout !== "vertical" && buttons.length === 2);

  // Only fold Cancel into the row when there are exactly two choices
  const cancelInRow = isHorizontal && buttons.length === 2 && !!cancelBtn;

  const rowButtons = isHorizontal
    ? cancelInRow
      ? [...iosActions, cancelBtn]
      : iosActions.length > 0
        ? iosActions
        : buttons
    : [];

  const showSeparateCancel = !!cancelBtn && !cancelInRow;

  // Sit just above footer tabs when on tab screens; otherwise clear system nav
  const sheetBottomPad =
    tabClearance > 0 ? tabClearance : getSheetBottomPadding(stableBottom);

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
            {/* Dim above footer tabs so nav stays readable */}
            <Animated.View
              style={[
                styles.dim,
                { bottom: tabClearance, opacity },
              ]}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
            </Animated.View>

            <Animated.View
              style={[
                styles.sheetWrap,
                {
                  paddingBottom: sheetBottomPad,
                  opacity,
                  transform: [{ translateY: slide }],
                },
              ]}
              pointerEvents="box-none"
            >
              {isHorizontal ? (
                <View style={styles.sheetCard}>
                  {(!!options?.title || !!options?.message) && (
                    <View style={styles.sheetHeader}>
                      {!!options?.title && (
                        <Text style={styles.sheetTitle}>{options.title}</Text>
                      )}
                      {!!options?.message && (
                        <Text style={styles.sheetMessage}>
                          {options.message}
                        </Text>
                      )}
                    </View>
                  )}
                  {(!!options?.title || !!options?.message) && (
                    <View style={styles.dividerH} />
                  )}
                  <View style={styles.sheetRow}>
                    {rowButtons.map((btn, i) => (
                      <React.Fragment key={`${btn.text}-${i}`}>
                        {i > 0 ? <View style={styles.dividerV} /> : null}
                        <View style={styles.sheetRowCell}>
                          <TouchableOpacity
                            activeOpacity={0.55}
                            onPress={() => handlePress(btn)}
                            style={styles.sheetRowBtn}
                          >
                            {renderActionLabel(btn, true)}
                          </TouchableOpacity>
                        </View>
                      </React.Fragment>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.sheetCard}>
                  {(!!options?.title || !!options?.message) && (
                    <View style={styles.sheetHeader}>
                      {!!options?.title && (
                        <Text style={styles.sheetTitle}>{options.title}</Text>
                      )}
                      {!!options?.message && (
                        <Text style={styles.sheetMessage}>
                          {options.message}
                        </Text>
                      )}
                    </View>
                  )}
                  {iosActions.map((btn, i) => {
                    const showDivider =
                      i > 0 || !!options?.title || !!options?.message;
                    return (
                      <React.Fragment key={`${btn.text}-${i}`}>
                        {showDivider ? <View style={styles.dividerH} /> : null}
                        <TouchableOpacity
                          activeOpacity={0.55}
                          onPress={() => handlePress(btn)}
                          style={styles.sheetBtn}
                        >
                          <Text style={buttonTextStyle(btn.style)}>
                            {btn.text}
                          </Text>
                        </TouchableOpacity>
                      </React.Fragment>
                    );
                  })}
                </View>
              )}

              {showSeparateCancel ? (
                <TouchableOpacity
                  activeOpacity={0.55}
                  onPress={() => handlePress(cancelBtn)}
                  style={styles.sheetCancel}
                >
                  <Text style={styles.sheetCancelText}>{cancelBtn.text}</Text>
                </TouchableOpacity>
              ) : null}
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  host: {
    ...StyleSheet.absoluteFillObject,
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
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    paddingHorizontal: 10,
    gap: 8,
    zIndex: 1,
    elevation: 1,
  },
  sheetCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: "hidden",
  },
  sheetHeader: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: C.title,
    textAlign: "center",
    letterSpacing: -0.2,
  },
  sheetMessage: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: C.message,
    textAlign: "center",
  },
  sheetBtn: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: C.card,
  },
  sheetBtnText: {
    fontSize: 17,
    fontWeight: "400",
    color: C.accent,
  },
  sheetBtnDanger: {
    color: C.danger,
    fontWeight: "600",
  },
  sheetCancel: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: {
    fontSize: 17,
    fontWeight: "600",
    color: C.accent,
  },
  dividerH: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
  },
  sheetRow: {
    flexDirection: "row",
    width: "100%",
    minHeight: 56,
    alignItems: "stretch",
  },
  sheetRowCell: {
    flex: 1,
    width: 0,
    minHeight: 56,
  },
  sheetRowBtn: {
    flex: 1,
    width: "100%",
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: C.card,
  },
  sheetRowBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sheetRowBtnLabel: {
    fontSize: 16,
  },
  dividerV: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: C.divider,
  },
});
