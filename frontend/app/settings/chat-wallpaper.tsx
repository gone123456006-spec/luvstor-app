import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import ChatWallpaperPattern from "../../components/ChatWallpaperPattern";
import ColorPickerSheet from "../../components/ColorPickerSheet";
import ListRowTouchable from "../../components/ListRowTouchable";
import {
  type A11yPrefs,
  autoBubbleColor,
  CHAT_WALLPAPERS,
  myBubbleColor,
  useAccessibility,
} from "../../contexts/AccessibilityContext";
import {
  BUBBLE_COLORS,
  CHAT_PATTERNS,
  type ChatPatternId,
  findPattern,
  isLightColor,
  mixHex,
} from "../../utils/chatPatterns";
import * as Haptics from "../../utils/haptics";
import { NAV_ICON, SHOW_ROW_CHEVRON } from "../../utils/platformIcons";
import { statusBarStyle, themedPalette, themedStyles } from "../../utils/theme";

const WA = themedPalette({
  bg: "#F5F5F7",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  border: "#E8E8ED",
  primary: "#370372",
  primarySoft: "#EFE8F8",
  frameBorder: "#D1D1D6",
});

const WALLPAPER_DIR = `${FileSystem.documentDirectory}wallpaper/`;

type SolidId = (typeof CHAT_WALLPAPERS)[number]["id"];

/** A wallpaper being previewed (not yet applied) */
type Candidate =
  | { kind: "solid"; id: SolidId }
  | { kind: "pattern"; id: ChatPatternId; dark: boolean }
  | { kind: "custom"; color: string }
  | { kind: "photo"; uri: string };

type View_ = "home" | "categories" | "bright" | "dark" | "solid" | "bubbles";

const TITLES: Record<View_, string> = {
  home: "Chat wallpaper",
  categories: "Wallpaper",
  bright: "Bright",
  dark: "Dark",
  solid: "Solid colours",
  bubbles: "Bubble colour",
};

async function deleteQuietly(uri: string | null) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}

function currentCandidate(prefs: A11yPrefs): Candidate {
  if (prefs.chatWallpaper === "photo" && prefs.chatWallpaperUri) {
    return { kind: "photo", uri: prefs.chatWallpaperUri };
  }
  if (prefs.chatWallpaper === "custom") return { kind: "custom", color: prefs.wallpaperCustom };
  const p = findPattern(prefs.chatWallpaper);
  if (p) return { kind: "pattern", id: p.id, dark: prefs.wallpaperDark };
  const solid = CHAT_WALLPAPERS.find((w) => w.id === prefs.chatWallpaper);
  return { kind: "solid", id: solid?.id ?? "classic" };
}

function candidateLabel(c: Candidate): string {
  if (c.kind === "photo") return "My photo";
  if (c.kind === "custom") return "Custom colour";
  if (c.kind === "pattern") {
    return `${findPattern(c.id)?.label ?? "Doodle"} · ${c.dark ? "Dark" : "Bright"}`;
  }
  return CHAT_WALLPAPERS.find((w) => w.id === c.id)?.label ?? "Solid colour";
}

/** Bubble colour this candidate would give when bubbles are on "auto" */
function candidateBubble(c: Candidate, prefs: A11yPrefs): string {
  const next: A11yPrefs =
    c.kind === "photo"
      ? { ...prefs, chatWallpaper: "photo", chatWallpaperUri: c.uri }
      : c.kind === "custom"
        ? { ...prefs, chatWallpaper: "custom", wallpaperCustom: c.color }
        : { ...prefs, chatWallpaper: c.id };
  if (c.kind === "pattern") {
    return autoBubbleColor({ ...next, bubbleColor: "auto", wallpaperDark: c.dark });
  }
  return myBubbleColor(next);
}

function WallpaperFill({
  c,
  width,
  height,
  dark,
  cell,
}: {
  c: Candidate;
  width: number;
  height: number;
  dark: boolean;
  cell?: number;
}) {
  if (c.kind === "photo") {
    return <Image source={{ uri: c.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />;
  }
  if (c.kind === "pattern") {
    const p = findPattern(c.id);
    return p ? (
      <ChatWallpaperPattern
        pattern={p}
        width={width}
        height={height}
        dark={dark || c.dark}
        cell={cell}
      />
    ) : null;
  }
  const color =
    c.kind === "custom"
      ? dark
        ? mixHex(c.color, "#0F0F13", 0.82)
        : c.color
      : (() => {
          const w = CHAT_WALLPAPERS.find((x) => x.id === c.id) ?? CHAT_WALLPAPERS[0];
          return dark ? w.darkColor : w.color;
        })();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />;
}

/** Phone-shaped mock of a chat on the given wallpaper */
function PhonePreview({
  c,
  width,
  bubble,
  dark,
  showChrome = true,
}: {
  c: Candidate;
  width: number;
  bubble: string;
  dark: boolean;
  showChrome?: boolean;
}) {
  const height = width * 1.78;
  const s = width / 180;
  return (
    <View style={[styles.phone, { width, height, borderRadius: 22 * s }]}>
      <WallpaperFill c={c} width={width} height={height} dark={dark} cell={34 * s} />
      {showChrome ? (
        <View style={[styles.phoneBar, { height: 30 * s, paddingHorizontal: 8 * s, gap: 6 * s }]}>
          <View style={[styles.phoneAvatar, { width: 16 * s, height: 16 * s, borderRadius: 8 * s }]} />
          <View style={[styles.phoneLine, { width: 52 * s, height: 6 * s, borderRadius: 3 * s }]} />
        </View>
      ) : null}
      <View style={[styles.phoneBody, { padding: 8 * s, gap: 6 * s }]}>
        <View
          style={[
            styles.mockBubble,
            styles.mockOther,
            { width: 92 * s, height: 22 * s, borderRadius: 8 * s },
          ]}
        />
        <View
          style={[
            styles.mockBubble,
            { backgroundColor: bubble, width: 78 * s, height: 22 * s, borderRadius: 8 * s },
          ]}
        />
        <View
          style={[
            styles.mockBubble,
            styles.mockOther,
            { width: 64 * s, height: 22 * s, borderRadius: 8 * s },
          ]}
        />
      </View>
      {showChrome ? (
        <View style={[styles.phoneInput, { height: 20 * s, margin: 8 * s, borderRadius: 10 * s }]} />
      ) : null}
    </View>
  );
}

export default function ChatWallpaperScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { prefs, setPref, isDark } = useAccessibility();
  const [view, setView] = useState<View_>("home");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<"wallpaper" | "bubble" | null>(null);

  const current = currentCandidate(prefs);
  const thumbW = (winW - 32 - 24) / 3;

  const goBack = () => {
    if (view === "bright" || view === "dark" || view === "solid") setView("categories");
    else if (view !== "home") setView("home");
    else router.back();
  };

  useEffect(() => {
    if (view === "home") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setView(view === "bright" || view === "dark" || view === "solid" ? "categories" : "home");
      return true;
    });
    return () => sub.remove();
  }, [view]);

  const applyCandidate = async (c: Candidate) => {
    const oldPhoto = prefs.chatWallpaperUri;
    if (c.kind === "photo") {
      setBusy(true);
      try {
        await FileSystem.makeDirectoryAsync(WALLPAPER_DIR, { intermediates: true }).catch(() => {});
        const dest = `${WALLPAPER_DIR}${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: c.uri, to: dest });
        setPref("chatWallpaperUri", dest);
        setPref("chatWallpaper", "photo");
        setPref("wallpaperDark", false);
        if (oldPhoto !== dest) void deleteQuietly(oldPhoto);
      } catch {
        setBusy(false);
        return;
      }
      setBusy(false);
    } else {
      setPref("wallpaperDark", c.kind === "pattern" && c.dark);
      if (c.kind === "custom") {
        setPref("wallpaperCustom", c.color);
        setPref("chatWallpaper", "custom");
      } else {
        setPref("chatWallpaper", c.id);
        if (c.kind === "pattern") setPref("bubbleColor", "auto");
      }
      setPref("chatWallpaperUri", null);
      void deleteQuietly(oldPhoto);
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCandidate(null);
    setView("home");
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setCandidate({ kind: "photo", uri: result.assets[0].uri });
  };

  const renderThumb = (c: Candidate, key: string, label: string, selected: boolean) => (
    <TouchableOpacity
      key={key}
      activeOpacity={0.8}
      onPress={() => setCandidate(c)}
      style={styles.thumbItem}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={[styles.thumb, { width: thumbW, height: thumbW * 1.78 }, selected && styles.thumbOn]}>
        <WallpaperFill c={c} width={thumbW} height={thumbW * 1.78} dark={isDark} cell={30} />
        {selected ? (
          <View style={styles.thumbCheck}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.thumbLabel, selected && styles.thumbLabelOn]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const bubbleOptions: { id: A11yPrefs["bubbleColor"]; label: string; color: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
    { id: "auto", label: "Auto", color: autoBubbleColor(prefs), icon: "sparkles" },
    ...BUBBLE_COLORS.map((b) => ({
      id: b.id,
      label: b.label,
      color: isDark ? (b.darkColor ?? b.color) : b.color,
    })),
    { id: "custom", label: "Custom", color: prefs.bubbleCustom, icon: "color-palette" },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle={statusBarStyle()} backgroundColor={WA.bg} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          style={styles.backBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {TITLES[view]}
        </Text>
      </View>

      <ScrollView
        key={view}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {view === "home" ? (
          <>
            <View style={styles.previewWrap}>
              <PhonePreview
                c={current}
                width={Math.min(200, winW * 0.48)}
                bubble={myBubbleColor(prefs)}
                dark={isDark}
              />
              <Text style={styles.currentLabel}>{candidateLabel(current)}</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setView("categories")}
                style={styles.changeBtn}
                accessibilityRole="button"
              >
                <Text style={styles.changeText}>Change</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.listGroup}>
              <ListRowTouchable
                style={styles.listRow}
                onPress={() => setView("bubbles")}
                accessibilityRole="button"
              >
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Bubble colour</Text>
                  <Text style={styles.rowSub}>
                    {bubbleOptions.find((b) => b.id === prefs.bubbleColor)?.label ?? "Black"}
                  </Text>
                </View>
                <View style={[styles.rowSwatch, { backgroundColor: myBubbleColor(prefs) }]} />
                {SHOW_ROW_CHEVRON ? (
                  <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
                ) : null}
              </ListRowTouchable>
              {current.kind !== "solid" || current.id !== "classic" ? (
                <>
                  <View style={styles.dividerFull} />
                  <ListRowTouchable
                    style={styles.listRow}
                    onPress={() => void applyCandidate({ kind: "solid", id: "classic" })}
                    accessibilityRole="button"
                  >
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>Reset wallpaper</Text>
                      <Text style={styles.rowSub}>Back to the classic look</Text>
                    </View>
                  </ListRowTouchable>
                </>
              ) : null}
            </View>
          </>
        ) : null}

        {view === "categories" ? (
          <View style={[styles.listGroup, styles.groupTop]}>
            {(
              [
                { key: "bright", label: "Bright", icon: "sunny", color: "#FF9500" },
                { key: "dark", label: "Dark", icon: "moon", color: "#5856D6" },
                { key: "solid", label: "Solid colours", icon: "color-fill", color: "#0A84FF" },
                { key: "photo", label: "My photos", icon: "images", color: "#34A853" },
              ] as const
            ).map((row, i) => (
              <React.Fragment key={row.key}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <ListRowTouchable
                  style={styles.listRow}
                  onPress={() => (row.key === "photo" ? void pickPhoto() : setView(row.key))}
                  accessibilityRole="button"
                >
                  <View style={[styles.iconCircle, { backgroundColor: row.color }]}>
                    <Ionicons name={row.icon} size={20} color="#FFFFFF" />
                  </View>
                  <Text style={[styles.rowLabel, styles.rowFlex]}>{row.label}</Text>
                  {SHOW_ROW_CHEVRON ? (
                    <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
                  ) : null}
                </ListRowTouchable>
              </React.Fragment>
            ))}
          </View>
        ) : null}

        {view === "bright" || view === "dark" ? (
          <View style={styles.grid}>
            {CHAT_PATTERNS.map((p) =>
              renderThumb(
                { kind: "pattern", id: p.id, dark: view === "dark" },
                p.id,
                p.label,
                current.kind === "pattern" &&
                  current.id === p.id &&
                  current.dark === (view === "dark"),
              ),
            )}
          </View>
        ) : null}

        {view === "solid" ? (
          <View style={styles.grid}>
            {CHAT_WALLPAPERS.map((w) =>
              renderThumb(
                { kind: "solid", id: w.id },
                w.id,
                w.label,
                current.kind === "solid" && current.id === w.id,
              ),
            )}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setPicker("wallpaper")}
              style={styles.thumbItem}
              accessibilityRole="button"
              accessibilityLabel="Custom colour"
            >
              <View
                style={[
                  styles.thumb,
                  styles.thumbCustom,
                  { width: thumbW, height: thumbW * 1.78, backgroundColor: prefs.wallpaperCustom },
                  current.kind === "custom" && styles.thumbOn,
                ]}
              >
                <Ionicons
                  name="color-palette"
                  size={26}
                  color={isLightColor(prefs.wallpaperCustom) ? "#370372" : "#FFFFFF"}
                />
              </View>
              <Text style={[styles.thumbLabel, current.kind === "custom" && styles.thumbLabelOn]}>
                Custom
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {view === "bubbles" ? (
          <>
            <View style={styles.previewWrap}>
              <PhonePreview
                c={current}
                width={Math.min(170, winW * 0.42)}
                bubble={myBubbleColor(prefs)}
                dark={isDark}
              />
            </View>
            <View style={styles.bubbleGrid}>
              {bubbleOptions.map((b) => {
                const on = prefs.bubbleColor === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    activeOpacity={0.75}
                    onPress={() => {
                      if (b.id === "custom") {
                        setPicker("bubble");
                        return;
                      }
                      void Haptics.selectionAsync();
                      setPref("bubbleColor", b.id);
                    }}
                    style={styles.bubbleItem}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${b.label} bubbles`}
                  >
                    <View style={[styles.bubbleSwatch, { backgroundColor: b.color }, on && styles.bubbleSwatchOn]}>
                      {on ? (
                        <Ionicons name="checkmark" size={22} color="#FFFFFF" />
                      ) : b.icon ? (
                        <Ionicons name={b.icon} size={18} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <Text style={[styles.thumbLabel, on && styles.thumbLabelOn]}>{b.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.footHint}>
              Auto matches your wallpaper. Picking a Bright or Dark wallpaper turns it on.
            </Text>
          </>
        ) : null}
      </ScrollView>

      {/* Full-screen preview, like "Set wallpaper" in WhatsApp */}
      <Modal
        visible={candidate !== null}
        animationType="slide"
        onRequestClose={() => setCandidate(null)}
        statusBarTranslucent
      >
        {candidate ? (
          <View style={styles.fullPreview}>
            <WallpaperFill c={candidate} width={winW} height={winH} dark={isDark} />
            <View style={[styles.fullHeader, { paddingTop: insets.top + 8 }]}>
              <TouchableOpacity
                onPress={() => setCandidate(null)}
                style={styles.fullClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
              </TouchableOpacity>
              <Text style={styles.fullTitle}>Preview</Text>
            </View>

            <View style={styles.fullBody}>
              <View style={styles.datePill}>
                <Text style={styles.datePillText}>Today</Text>
              </View>
              <View style={[styles.fullBubble, styles.fullBubbleOther]}>
                <Text style={styles.fullBubbleText}>Hey! Did you change the wallpaper?</Text>
              </View>
              <View style={[styles.fullBubble, styles.fullBubbleOther]}>
                <Text style={styles.fullBubbleText}>This is how {candidateLabel(candidate)} looks 👀</Text>
              </View>
              <View
                style={[
                  styles.fullBubble,
                  styles.fullBubbleMe,
                  { backgroundColor: candidateBubble(candidate, prefs) },
                ]}
              >
                <Text style={[styles.fullBubbleText, styles.fullBubbleTextMe]}>Looks great, setting it now</Text>
              </View>
            </View>

            <View style={[styles.fullFooter, { paddingBottom: insets.bottom + 16 }]}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => void applyCandidate(candidate)}
                style={styles.setBtn}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.setText}>Set wallpaper</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Modal>

      <ColorPickerSheet
        visible={picker !== null}
        kind={picker ?? "wallpaper"}
        title={picker === "bubble" ? "Your bubble colour" : "Wallpaper colour"}
        initial={picker === "bubble" ? prefs.bubbleCustom : prefs.wallpaperCustom}
        onClose={() => setPicker(null)}
        onPick={(color) => {
          if (picker === "bubble") {
            setPref("bubbleCustom", color);
            setPref("bubbleColor", "custom");
          } else {
            setCandidate({ kind: "custom", color });
          }
        }}
      />
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
    scroll: { paddingTop: 8 },

    previewWrap: { alignItems: "center", paddingTop: 20, paddingBottom: 24 },
    currentLabel: { marginTop: 14, fontSize: 14, color: WA.secondary },
    changeBtn: {
      marginTop: 12,
      paddingHorizontal: 32,
      height: 44,
      borderRadius: 22,
      backgroundColor: WA.primarySoft,
      justifyContent: "center",
      alignItems: "center",
    },
    changeText: { fontSize: 16, fontWeight: "600", color: WA.primary },

    phone: {
      overflow: "hidden",
      borderWidth: 3,
      borderColor: WA.frameBorder,
      backgroundColor: WA.white,
    },
    phoneBar: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: WA.white,
    },
    phoneAvatar: { backgroundColor: WA.border },
    phoneLine: { backgroundColor: WA.border },
    phoneBody: { flex: 1, justifyContent: "flex-end" },
    phoneInput: { backgroundColor: WA.white },
    mockBubble: { alignSelf: "flex-end" },
    mockOther: { alignSelf: "flex-start", backgroundColor: WA.white },

    listGroup: { backgroundColor: WA.white },
    groupTop: { marginTop: 16 },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 16,
    },
    rowContent: { flex: 1 },
    rowFlex: { flex: 1 },
    rowLabel: { fontSize: 17, color: WA.text },
    rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
    rowSwatch: { width: 26, height: 26, borderRadius: 13 },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: WA.border,
      marginLeft: 72,
    },
    dividerFull: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: WA.border,
      marginLeft: 16,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: "center",
      alignItems: "center",
    },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      paddingHorizontal: 16,
      paddingTop: 12,
      columnGap: 12,
      rowGap: 18,
    },
    thumbItem: { alignItems: "center", gap: 6 },
    thumb: {
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
    },
    thumbCustom: { justifyContent: "center", alignItems: "center" },
    thumbOn: { borderWidth: 3, borderColor: WA.primary },
    thumbCheck: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "#370372",
      justifyContent: "center",
      alignItems: "center",
    },
    thumbLabel: { fontSize: 12, color: WA.secondary },
    thumbLabelOn: { color: WA.primary, fontWeight: "600" },

    bubbleGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 22,
      backgroundColor: WA.white,
    },
    bubbleItem: { width: "25%", alignItems: "center", paddingVertical: 10, gap: 6 },
    bubbleSwatch: {
      width: 52,
      height: 52,
      borderRadius: 26,
      justifyContent: "center",
      alignItems: "center",
    },
    bubbleSwatchOn: { borderWidth: 3, borderColor: WA.primarySoft },
    footHint: {
      fontSize: 12,
      color: WA.secondary,
      paddingHorizontal: 20,
      paddingTop: 10,
    },

    fullPreview: { flex: 1 },
    fullHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingBottom: 10,
      backgroundColor: WA.bg,
    },
    fullClose: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: "center",
      alignItems: "center",
    },
    fullTitle: { fontSize: 20, fontWeight: "700", color: WA.text },
    fullBody: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 12, gap: 6 },
    datePill: {
      alignSelf: "center",
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: WA.white,
      marginBottom: 6,
    },
    datePillText: { fontSize: 12, color: WA.secondary },
    fullBubble: {
      maxWidth: "80%",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 14,
    },
    fullBubbleOther: {
      alignSelf: "flex-start",
      backgroundColor: WA.white,
      borderTopLeftRadius: 4,
    },
    fullBubbleMe: { alignSelf: "flex-end", borderTopRightRadius: 4 },
    fullBubbleText: { fontSize: 15.5, lineHeight: 20.5, color: WA.text },
    fullBubbleTextMe: { color: "#FFFFFF" },
    fullFooter: { paddingHorizontal: 16, paddingTop: 16 },
    setBtn: {
      height: 52,
      borderRadius: 26,
      backgroundColor: "#370372",
      justifyContent: "center",
      alignItems: "center",
    },
    setText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  }),
);
