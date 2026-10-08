import React from "react";
import {
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { tc } from "../utils/theme";

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** Kept for drop-in compatibility with TouchableOpacity; unused. */
  activeOpacity?: number;
};

const IOS_HIGHLIGHT = "#E5E5EA";

/**
 * List row with each platform's native press feedback:
 * iOS table-cell grey highlight, Android Material ripple.
 */
export default function ListRowTouchable({
  style,
  activeOpacity: _activeOpacity,
  children,
  ...rest
}: Props) {
  return (
    <Pressable
      {...rest}
      android_ripple={
        Platform.OS === "android" ? { color: tc("rgba(0,0,0,0.08)", "fg") } : undefined
      }
      style={({ pressed }) => [
        style,
        pressed && Platform.OS === "ios" && { backgroundColor: tc(IOS_HIGHLIGHT, "bg") },
      ]}
    >
      {children}
    </Pressable>
  );
}
