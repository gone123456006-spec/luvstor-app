import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colorGrid, isLightColor } from "../utils/chatPatterns";
import * as Haptics from "../utils/haptics";
import { themedPalette, themedStyles } from "../utils/theme";

const C = themedPalette({
  sheet: "#F5F6F8",
  card: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  primary: "#370372",
});

type Props = {
  visible: boolean;
  title: string;
  kind: "wallpaper" | "bubble";
  initial: string;
  onClose: () => void;
  onPick: (color: string) => void;
};

/** Bottom sheet with a grid of shades; "bubble" only offers colours dark enough for white text */
export default function ColorPickerSheet({ visible, title, kind, initial, onClose, onPick }: Props) {
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setPicked(initial);
  }
  const grid = colorGrid(kind);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View style={[styles.previewDot, { backgroundColor: picked }]}>
            {kind === "bubble" ? <Text style={styles.previewAa}>Aa</Text> : null}
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.hex}>{picked}</Text>
          </View>
        </View>

        <View style={styles.card}>
          {grid.map((row, ri) => (
            <View key={ri} style={styles.row}>
              {row.map((color) => {
                const on = color === picked;
                return (
                  <TouchableOpacity
                    key={color}
                    activeOpacity={0.7}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setPicked(color);
                    }}
                    style={styles.cellWrap}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={color}
                  >
                    <View style={[styles.cell, { backgroundColor: color }, on && styles.cellOn]}>
                      {on ? <Ionicons name="checkmark" size={12} color={isLightColor(color) ? "#1C1B1F" : "#FFFFFF"} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.doneBtn}
          onPress={() => {
            onPick(picked);
            onClose();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.doneText}>Use this colour</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      backgroundColor: C.sheet,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: "rgba(0,0,0,0.15)",
      marginBottom: 14,
    },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
    previewDot: {
      width: 48,
      height: 48,
      borderRadius: 24,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.15)",
    },
    previewAa: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
    headerText: { flex: 1 },
    title: { fontSize: 18, fontWeight: "700", color: C.text },
    hex: { fontSize: 13, color: C.secondary, marginTop: 2 },
    card: { backgroundColor: C.card, borderRadius: 22, padding: 10, gap: 4 },
    row: { flexDirection: "row" },
    cellWrap: { flex: 1, aspectRatio: 1, padding: 2 },
    cell: {
      flex: 1,
      borderRadius: 999,
      justifyContent: "center",
      alignItems: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.1)",
    },
    cellOn: { borderWidth: 2, borderColor: C.primary },
    doneBtn: {
      marginTop: 16,
      height: 52,
      borderRadius: 26,
      backgroundColor: C.primary,
      justifyContent: "center",
      alignItems: "center",
    },
    doneText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  }),
);
