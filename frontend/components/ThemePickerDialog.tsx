import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { type ThemeMode, useAccessibility } from "../contexts/AccessibilityContext";
import * as Haptics from "../utils/haptics";
import { themeState, themedPalette, themedStyles } from "../utils/theme";

const C = themedPalette({
  card: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  primary: "#370372",
});

export const THEME_LABELS: Record<ThemeMode, string> = {
  system: "System default",
  light: "Light",
  dark: "Dark",
};

const ORDER: ThemeMode[] = ["system", "light", "dark"];

/** WhatsApp-style "Choose theme" dialog; the app restyles and returns to `returnTo` */
export default function ThemePickerDialog({
  visible,
  onClose,
  returnTo,
}: {
  visible: boolean;
  onClose: () => void;
  returnTo: string;
}) {
  const { prefs, setPref, remountApp } = useAccessibility();
  const [choice, setChoice] = useState<ThemeMode>(prefs.themeMode);

  const apply = () => {
    onClose();
    if (choice === prefs.themeMode) return;
    void Haptics.selectionAsync();
    const wasDark = themeState.dark;
    setPref("themeMode", choice);
    if (themeState.dark !== wasDark) remountApp(returnTo);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => setChoice(prefs.themeMode)}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title} accessibilityRole="header">
            Choose theme
          </Text>
          <View accessibilityRole="radiogroup">
            {ORDER.map((mode) => {
              const on = choice === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={styles.option}
                  activeOpacity={0.6}
                  onPress={() => setChoice(mode)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={THEME_LABELS[mode]}
                >
                  <Ionicons
                    name={on ? "radio-button-on" : "radio-button-off"}
                    size={24}
                    color={on ? C.primary : C.secondary}
                  />
                  <Text style={styles.optionText}>{THEME_LABELS[mode]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={styles.actionBtn} accessibilityRole="button">
              <Text style={styles.actionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={apply} style={styles.actionBtn} accessibilityRole="button">
              <Text style={styles.actionText}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      paddingHorizontal: 32,
    },
    card: {
      backgroundColor: C.card,
      borderRadius: 24,
      paddingTop: 22,
      paddingBottom: 10,
      paddingHorizontal: 22,
    },
    title: { fontSize: 20, fontWeight: "600", color: C.text, marginBottom: 12 },
    option: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 12 },
    optionText: { fontSize: 16, color: C.text },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: 4, marginTop: 8 },
    actionBtn: { paddingHorizontal: 14, paddingVertical: 10 },
    actionText: { fontSize: 15, fontWeight: "600", color: C.primary },
  }),
);
