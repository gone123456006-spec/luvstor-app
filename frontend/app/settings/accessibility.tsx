import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Linking,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ListRowTouchable from "../../components/ListRowTouchable";
import {
  CHAT_TEXT_SIZES,
  type ChatTextSize,
  useAccessibility,
  wallpaperColor,
} from "../../contexts/AccessibilityContext";
import * as Haptics from "../../utils/haptics";
import { NAV_ICON, SHOW_ROW_CHEVRON } from "../../utils/platformIcons";
import { statusBarStyle, tc, themedPalette, themedStyles } from "../../utils/theme";

const WA = themedPalette({
  bg: "#F5F5F7",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  border: "#E8E8ED",
  primary: "#370372",
  primarySoft: "#EFE8F8",
  chatBg: "#ECE5DD",
});

const SIZE_ORDER: ChatTextSize[] = ["small", "default", "large", "xlarge"];

function openDeviceAccessibility() {
  if (Platform.OS === "android") {
    Linking.sendIntent("android.settings.ACCESSIBILITY_SETTINGS").catch(() => {
      void Linking.openSettings();
    });
  } else {
    void Linking.openSettings();
  }
}

function ToggleRow({
  icon,
  color,
  label,
  sub,
  value,
  onChange,
  showDivider,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  showDivider?: boolean;
}) {
  return (
    <>
      <View style={styles.listRow}>
        <View style={[styles.iconCircle, { backgroundColor: color }]}>
          <Ionicons name={icon} size={20} color="#fff" />
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowSub}>{sub}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: "#D0C4DC", true: "#B8A1E3" }}
          thumbColor={value ? WA.primary : "#f4f3f4"}
          {...(Platform.OS === "ios" ? { ios_backgroundColor: tc("#D0C4DC", "bg") } : {})}
          accessibilityLabel={label}
        />
      </View>
      {showDivider ? <View style={styles.divider} /> : null}
    </>
  );
}

export default function AccessibilityScreen() {
  const router = useRouter();
  const { prefs, reduceMotion, systemReduceMotion, setPref, reset, remountApp } =
    useAccessibility();
  const size = CHAT_TEXT_SIZES[prefs.chatTextSize];

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
          Accessibility
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Chat text ── */}
        <Text style={styles.sectionHint}>Chat text size</Text>
        <View style={styles.card}>
          <View
            style={[styles.preview, { backgroundColor: wallpaperColor(prefs) }]}
            accessible
            accessibilityLabel="Preview"
          >
            <View style={[styles.bubble, styles.bubbleOther]}>
              <Text
                style={[
                  styles.bubbleText,
                  { fontSize: size.fontSize, lineHeight: size.lineHeight },
                  prefs.boldChatText && styles.bold,
                ]}
              >
                Hey! How was your day? 😊
              </Text>
            </View>
            <View style={[styles.bubble, styles.bubbleMe]}>
              <Text
                style={[
                  styles.bubbleText,
                  styles.bubbleTextMe,
                  { fontSize: size.fontSize, lineHeight: size.lineHeight },
                  prefs.boldChatText && styles.bold,
                ]}
              >
                Pretty good, just got back from a walk
              </Text>
            </View>
          </View>

          <View style={styles.sizeRow} accessibilityRole="radiogroup">
            {SIZE_ORDER.map((key, i) => {
              const on = prefs.chatTextSize === key;
              return (
                <TouchableOpacity
                  key={key}
                  activeOpacity={0.75}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPref("chatTextSize", key);
                  }}
                  style={[styles.sizeChip, on && styles.sizeChipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={CHAT_TEXT_SIZES[key].label}
                >
                  <Text
                    style={[
                      styles.sizeGlyph,
                      { fontSize: 13 + i * 3 },
                      on && styles.sizeTextOn,
                    ]}
                  >
                    A
                  </Text>
                  <Text style={[styles.sizeLabel, on && styles.sizeTextOn]}>
                    {CHAT_TEXT_SIZES[key].label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.listGroup, styles.groupSpaced]}>
          <ToggleRow
            icon="text"
            color={tc("#6750A4", "fg")}
            label="Bold chat text"
            sub="Thicker letters in message bubbles"
            value={prefs.boldChatText}
            onChange={(v) => setPref("boldChatText", v)}
            showDivider
          />
          <ToggleRow
            icon="reader"
            color="#AF52DE"
            label="Bold text everywhere"
            sub="Thicker letters on every screen of the app"
            value={prefs.boldAll}
            onChange={(v) => {
              setPref("boldAll", v);
              remountApp("/settings/accessibility");
            }}
          />
        </View>

        {/* ── Motion & feedback ── */}
        <Text style={styles.sectionHint}>Motion & feedback</Text>
        <View style={styles.listGroup}>
          <ToggleRow
            icon="sparkles"
            color="#0A84FF"
            label="Reduce motion"
            sub={
              prefs.reduceMotion === null
                ? `Following your phone (${systemReduceMotion ? "on" : "off"})`
                : "Turns off screen transitions and animations"
            }
            value={reduceMotion}
            onChange={(v) => setPref("reduceMotion", v)}
            showDivider
          />
          <ToggleRow
            icon="phone-portrait"
            color="#FF9500"
            label="Haptic feedback"
            sub="Gentle vibration on taps, swipes and sends"
            value={prefs.haptics}
            onChange={(v) => {
              setPref("haptics", v);
              if (v) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          />
        </View>

        {/* ── Device ── */}
        <Text style={styles.sectionHint}>Device</Text>
        <View style={styles.listGroup}>
          <ListRowTouchable
            style={styles.listRow}
            onPress={openDeviceAccessibility}
            accessibilityRole="button"
          >
            <View style={[styles.iconCircle, { backgroundColor: "#34A853" }]}>
              <Ionicons name="accessibility" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>
                {Platform.OS === "android"
                  ? "Phone accessibility settings"
                  : "Open iPhone Settings"}
              </Text>
              <Text style={styles.rowSub}>
                App text follows your phone&apos;s font size, screen reader and
                display settings
              </Text>
            </View>
            {SHOW_ROW_CHEVRON ? (
              <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
            ) : null}
          </ListRowTouchable>
        </View>

        <TouchableOpacity
          onPress={reset}
          activeOpacity={0.7}
          style={styles.resetBtn}
          accessibilityRole="button"
        >
          <Text style={styles.resetText}>Reset to default</Text>
        </TouchableOpacity>
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
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: WA.text,
  },
  scroll: { paddingBottom: 40, paddingTop: 8 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 18,
    backgroundColor: WA.white,
    overflow: "hidden",
  },
  preview: {
    backgroundColor: WA.chatBg,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 8,
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: WA.white,
    borderTopLeftRadius: 4,
  },
  bubbleMe: {
    alignSelf: "flex-end",
    backgroundColor: WA.primary,
    borderTopRightRadius: 4,
  },
  bubbleText: { color: "#333" },
  bubbleTextMe: { color: "#fff" },
  bold: { fontWeight: "600" },
  sizeRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
  },
  sizeChip: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: WA.bg,
  },
  sizeChipOn: { backgroundColor: WA.primary },
  sizeGlyph: { fontWeight: "700", color: WA.text },
  sizeLabel: { fontSize: 11, fontWeight: "600", color: WA.secondary },
  sizeTextOn: { color: "#fff" },
  listGroup: { backgroundColor: WA.white },
  groupSpaced: { marginTop: 12 },
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
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 17, color: WA.text },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
  resetBtn: {
    alignSelf: "center",
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  resetText: { fontSize: 15, fontWeight: "600", color: "#EA4335" },
}),
);
