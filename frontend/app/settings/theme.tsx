import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ListRowTouchable from "../../components/ListRowTouchable";
import { type ThemeMode, useAccessibility } from "../../contexts/AccessibilityContext";
import * as Haptics from "../../utils/haptics";
import { NAV_ICON } from "../../utils/platformIcons";
import { statusBarStyle, themeState, themedPalette, themedStyles } from "../../utils/theme";

const WA = themedPalette({
  bg: "#F5F5F7",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  border: "#E8E8ED",
  primary: "#370372",
  primarySoft: "#EFE8F8",
});

const OPTIONS: { mode: ThemeMode; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: "light", label: "Light", sub: "Always use the light look", icon: "sunny" },
  { mode: "dark", label: "Dark", sub: "Easier on the eyes at night", icon: "moon" },
  {
    mode: "system",
    label: "Follow phone",
    sub: "Switch with your phone's dark mode",
    icon: "phone-portrait",
  },
];

export default function ThemeScreen() {
  const router = useRouter();
  const { prefs, setPref, remountApp } = useAccessibility();

  const choose = (mode: ThemeMode) => {
    if (mode === prefs.themeMode) return;
    void Haptics.selectionAsync();
    const wasDark = themeState.dark;
    setPref("themeMode", mode);
    if (themeState.dark !== wasDark) remountApp("/settings/theme");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle={statusBarStyle()} backgroundColor={WA.bg} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Theme
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.listGroup} accessibilityRole="radiogroup">
          {OPTIONS.map((o, i) => {
            const on = prefs.themeMode === o.mode;
            return (
              <React.Fragment key={o.mode}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ListRowTouchable
                  style={styles.listRow}
                  onPress={() => choose(o.mode)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.label}
                >
                  <View style={styles.iconCircle}>
                    <Ionicons name={o.icon} size={20} color={WA.primary} />
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={styles.rowLabel}>{o.label}</Text>
                    <Text style={styles.rowSub}>{o.sub}</Text>
                  </View>
                  <Ionicons
                    name={on ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={on ? WA.primary : WA.secondary}
                  />
                </ListRowTouchable>
              </React.Fragment>
            );
          })}
        </View>
        <Text style={styles.footnote}>
          Dark mode covers the main tabs, chats, settings and popups. A few other screens
          stay light for now.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: WA.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: WA.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: WA.border,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: WA.primarySoft,
      justifyContent: "center",
      alignItems: "center",
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: WA.text },
    scroll: { paddingTop: 16, paddingBottom: 40 },
    listGroup: { backgroundColor: WA.white },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 16,
      gap: 16,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: WA.border,
      marginLeft: 72,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: WA.primarySoft,
      justifyContent: "center",
      alignItems: "center",
    },
    rowContent: { flex: 1 },
    rowLabel: { fontSize: 17, color: WA.text },
    rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
    footnote: {
      fontSize: 13,
      color: WA.secondary,
      paddingHorizontal: 20,
      paddingTop: 12,
      lineHeight: 18,
    },
  }),
);
