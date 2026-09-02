import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Match AppAlert iOS action sheet tokens */
const C = {
  accent: "#007AFF",
  danger: "#FF3B30",
  title: "#000000",
  message: "#3C3C43",
  divider: "rgba(60, 60, 67, 0.29)",
  card: "#FFFFFF",
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
  const insets = useSafeAreaInsets();
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={styles.backdropPress} onPress={onDismiss} />

        <Animated.View
          style={[
            styles.sheetWrap,
            {
              paddingBottom: Math.max(insets.bottom, 10),
              transform: [{ translateY: slide }],
            },
          ]}
        >
          <View style={styles.sheetCard}>
            <View style={styles.sheetHeader}>
              {!!alertText && (
                <Text style={styles.alertText}>{alertText}</Text>
              )}
              <Text style={styles.sheetMessage}>{message}</Text>
            </View>

            <View style={styles.dividerH} />
            <TouchableOpacity
              activeOpacity={0.55}
              onPress={onTransfer}
              disabled={disabled || loading}
              style={[styles.sheetBtn, (disabled || loading) && styles.sheetBtnDisabled]}
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
      </Animated.View>
    </Modal>
  );
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
  alertText: {
    fontSize: 15,
    fontWeight: "600",
    color: C.danger,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  sheetMessage: {
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
  sheetBtnDisabled: {
    opacity: 0.45,
  },
  sheetBtnText: {
    fontSize: 17,
    fontWeight: "400",
    color: C.accent,
  },
  sheetBtnTextDisabled: {
    color: C.message,
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
});
