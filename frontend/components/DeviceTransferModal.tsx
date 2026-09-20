import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { getSheetBottomPadding } from "../utils/navigation";
import { useStableBottomInset } from "../hooks/useStableBottomInset";
import { useTabBarOverlayInset } from "../hooks/useTabBarOverlayInset";

/** Match AppAlert iOS action sheet tokens */
const C = {
  accent: "#007AFF",
  danger: "#FF3B30",
  title: "#000000",
  message: "#3C3C43",
  divider: "rgba(60, 60, 67, 0.29)",
  card: "#E4E6EB",
  backdrop: "rgba(0, 0, 0, 0.4)",
};

type Props = {
  visible: boolean;
  /** Red warning line in the sheet header */
  alertText?: string;
  message: string;
  buttonText?: string;
  loading?: boolean;
  disabled?: boolean;
  onTransfer: () => void;
  onDismiss?: () => void;
};

/** iOS-style bottom action sheet for device transfer. */
export default function DeviceTransferModal({
  visible,
  alertText = "Already logged in on another device",
  message,
  buttonText = "Transfer Device",
  loading = false,
  disabled = false,
  onTransfer,
  onDismiss,
}: Props) {
  const stableBottom = useStableBottomInset();
  const tabClearance = useTabBarOverlayInset();
  const opacity = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(48)).current;

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

  useEffect(() => {
    if (visible) animateIn();
  }, [visible, animateIn]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismiss?.();
      return true;
    });
    return () => sub.remove();
  }, [visible, onDismiss]);

  if (!visible) return null;

  const sheetBottomPad =
    tabClearance > 0 ? tabClearance : getSheetBottomPadding(stableBottom);

  return (
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View
        style={[styles.dim, { bottom: tabClearance, opacity }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
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
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            {!!alertText && <Text style={styles.alertText}>{alertText}</Text>}
            <Text style={styles.sheetMessage}>{message}</Text>
          </View>

          <View style={styles.dividerH} />
          <TouchableOpacity
            activeOpacity={0.55}
            onPress={onTransfer}
            disabled={disabled || loading}
            style={[
              styles.sheetBtn,
              (disabled || loading) && styles.sheetBtnDisabled,
            ]}
          >
            {loading ? (
              <ActivityIndicator color={C.accent} size="small" />
            ) : (
              <Text
                style={[
                  styles.sheetBtnText,
                  disabled && styles.sheetBtnTextDisabled,
                ]}
              >
                {buttonText}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.55}
          onPress={onDismiss}
          disabled={loading}
          style={styles.sheetCancel}
        >
          <Text style={styles.sheetCancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  alertText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.danger,
    textAlign: "center",
    marginBottom: 8,
  },
  sheetMessage: {
    fontSize: 13,
    lineHeight: 18,
    color: C.message,
    textAlign: "center",
  },
  dividerH: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.divider,
  },
  sheetBtn: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: C.card,
  },
  sheetBtnDisabled: {
    opacity: 0.5,
  },
  sheetBtnText: {
    fontSize: 17,
    fontWeight: "400",
    color: C.accent,
  },
  sheetBtnTextDisabled: {
    color: "#8E8E93",
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
});
