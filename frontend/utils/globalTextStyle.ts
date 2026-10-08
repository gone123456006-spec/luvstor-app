/**
 * App-wide "Bold text" (Settings → Accessibility).
 *
 * Compiled code reads `Text` from the react-native exports object on every
 * render, so redefining that getter makes every <Text> resolve a bolder weight
 * from its final, flattened style. Changes need a navigator remount (uiKey).
 * Components captured at load time (e.g. Animated.Text) keep the original.
 */
import React from "react";
import {
  StyleSheet,
  unstable_TextAncestorContext,
  type TextProps,
  type TextStyle,
} from "react-native";
import { a11yState } from "./a11yState";

type Weight = string | number | undefined;

function bolder(w: Weight): Weight {
  const n = w === undefined || w === "normal" ? 400 : w === "bold" ? 700 : Number(w);
  if (!Number.isFinite(n)) return w;
  if (n >= 700) return w;
  return n >= 500 ? "700" : "600";
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RN = require("react-native") as { Text: React.ComponentType<TextProps> };
const BaseText = RN.Text;

function BoldAwareText(props: TextProps) {
  const nested = React.useContext(unstable_TextAncestorContext);
  if (!a11yState.boldAll) return React.createElement(BaseText, props);
  const flat = StyleSheet.flatten(props.style);
  // Nested text without its own weight inherits the parent's (already bolder) one
  if (nested && flat?.fontWeight === undefined) {
    return React.createElement(BaseText, props);
  }
  const fontWeight = bolder(flat?.fontWeight) as TextStyle["fontWeight"];
  return React.createElement(BaseText, {
    ...props,
    style: [props.style, { fontWeight }],
  });
}
BoldAwareText.displayName = "Text";

try {
  Object.defineProperty(RN, "Text", {
    configurable: true,
    enumerable: true,
    get: () => BoldAwareText,
  });
} catch {
  // Non-configurable export — bold-everywhere unavailable
}
