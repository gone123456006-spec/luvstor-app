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
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  /** Side-by-side actions: destructive left, others right. Cancel stays on its own row below. */
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
  card: "#FFFFFF",
  backdrop: "rgba(0, 0, 0, 0.4)",
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
  const insets = useSafeAreaInsets();
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

  const isHorizontal = options?.actionsLayout === "horizontal" && iosActions.length > 0;

  return (
    <AppAlertContext.Provider value={value}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => close()}
      >
        <Animated.View
          style={[styles.backdrop, { opacity }]}
        >
          <Pressable style={styles.backdropPress} onPress={() => close()} />

          <Animated.View
            style={[
              styles.sheetWrap,
              {
                paddingBottom: Math.max(insets.bottom, 10),
                opacity,
                transform: [{ translateY: slide }],
              },
            ]}
          >
            {isHorizontal ? (
              <View style={styles.sheetCard}>
                {(!!options?.title || !!options?.message) && (
                  <View style={styles.sheetHeader}>
                    {!!options?.title && (
                      <Text style={styles.sheetTitle}>{options.title}</Text>
                    )}
                    {!!options?.message && (
                      <Text style={styles.sheetMessage}>{options.message}</Text>
                    )}
                  </View>
                )}
                {(!!options?.title || !!options?.message) && (
                  <View style={styles.dividerH} />
                )}
                <View style={styles.sheetRow}>
                  {iosActions.map((btn, i) => (
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
                      <Text style={styles.sheetMessage}>{options.message}</Text>
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

            {cancelBtn ? (
              <TouchableOpacity
                activeOpacity={0.55}
                onPress={() => handlePress(cancelBtn)}
                style={styles.sheetCancel}
              >
                <Text style={styles.sheetCancelText}>{cancelBtn.text}</Text>
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </Animated.View>
      </Modal>
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
  backdrop: {
    flex: 1,
    backgroundColor: C.backdrop,
    justifyContent: "flex-end",
    paddingHorizontal: 10,
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetWrap: {
    width: "100%",
    gap: 8,
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
