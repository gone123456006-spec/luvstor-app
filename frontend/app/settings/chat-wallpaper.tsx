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
import ChatGradientWallpaper from "../../components/ChatGradientWallpaper";
import { PaperWallpaper, SceneWallpaper } from "../../components/ChatSceneWallpaper";
import ChatWallpaperPattern from "../../components/ChatWallpaperPattern";
import ColorPickerSheet from "../../components/ColorPickerSheet";
import DeferredMount from "../../components/DeferredMount";
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
  CHAT_GRADIENTS,
  CHAT_PATTERNS,
  type ChatPatternId,
  findGradient,
  findPattern,
  type GradientId,
  isLightColor,
  mixHex,
} from "../../utils/chatPatterns";
import {
  CHAT_PAPERS,
  CHAT_SCENES,
  findPaper,
  findScene,
  type PaperId,
  type SceneId,
} from "../../utils/chatScenes";
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
  | { kind: "gradient"; id: GradientId }
  | { kind: "paper"; id: PaperId }
  | { kind: "scene"; id: SceneId }
  | { kind: "custom"; color: string }
  | { kind: "photo"; uri: string };

type View_ =
  | "home"
  | "categories"
  | "bright"
  | "dark"
  | "solid"
  | "gradients"
  | "art"
  | "themes"
  | "illustrated"
  | "paper"
  | "bubbles";

const SUB_VIEWS: View_[] = [
  "bright",
  "dark",
  "solid",
  "gradients",
  "art",
  "themes",
  "illustrated",
  "paper",
];

const TITLES: Record<View_, string> = {
  home: "Chat wallpaper",
  categories: "Wallpaper",
  bright: "Bright",
  dark: "Dark",
  solid: "Solid colours",
  gradients: "Gradients",
  art: "Art",
  themes: "Themes",
  illustrated: "Illustrated",
  paper: "Paper",
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
  const g = findGradient(prefs.chatWallpaper);
  if (g) return { kind: "gradient", id: g.id };
  const paper = findPaper(prefs.chatWallpaper);
  if (paper) return { kind: "paper", id: paper.id };
  const scene = findScene(prefs.chatWallpaper);
  if (scene) return { kind: "scene", id: scene.id };
  const solid = CHAT_WALLPAPERS.find((w) => w.id === prefs.chatWallpaper);
  return { kind: "solid", id: solid?.id ?? "classic" };
}

function candidateLabel(c: Candidate): string {
  if (c.kind === "photo") return "My photo";
  if (c.kind === "custom") return "Custom colour";
  if (c.kind === "gradient") return findGradient(c.id)?.label ?? "Gradient";
  if (c.kind === "paper") return findPaper(c.id)?.label ?? "Paper";
  if (c.kind === "scene") return findScene(c.id)?.label ?? "Illustrated";
  if (c.kind === "pattern") {
    return `${findPattern(c.id)?.label ?? "Doodle"} · ${c.dark ? "Dark" : "Bright"}`;
  }
  return CHAT_WALLPAPERS.find((w) => w.id === c.id)?.label ?? "Solid colour";
}

const QUICK_PICKS: Candidate[] = [
  { kind: "solid", id: "classic" },
  { kind: "scene", id: "i-sakura-breeze" },
  { kind: "pattern", id: "doodle", dark: false },
  { kind: "gradient", id: "g-sunset" },
  { kind: "paper", id: "p-notebook" },
  { kind: "scene", id: "i-cozy-cat" },
  { kind: "gradient", id: "t-flowers" },
  { kind: "scene", id: "i-neon-night" },
  { kind: "gradient", id: "g-aurora" },
];

const GRID_ITEMS: Partial<Record<View_, Candidate[]>> = {
  bright: CHAT_PATTERNS.map((p): Candidate => ({
    kind: "pattern",
    id: p.id,
    dark: false,
  })),
  dark: CHAT_PATTERNS.map((p): Candidate => ({
    kind: "pattern",
    id: p.id,
    dark: true,
  })),
  gradients: CHAT_GRADIENTS.filter((g) => !g.pattern && !g.stickers).map((g): Candidate => ({
    kind: "gradient",
    id: g.id,
  })),
  art: CHAT_GRADIENTS.filter((g) => !!g.pattern).map((g): Candidate => ({
    kind: "gradient",
    id: g.id,
  })),
  themes: CHAT_GRADIENTS.filter((g) => !!g.stickers).map((g): Candidate => ({
    kind: "gradient",
    id: g.id,
  })),
  illustrated: CHAT_SCENES.map((sc): Candidate => ({
    kind: "scene",
    id: sc.id,
  })),
  paper: CHAT_PAPERS.map((pp): Candidate => ({ kind: "paper", id: pp.id })),
  solid: CHAT_WALLPAPERS.map((w): Candidate => ({ kind: "solid", id: w.id })),
};

function candidateKey(c: Candidate): string {
  if (c.kind === "photo") return `photo:${c.uri}`;
  if (c.kind === "custom") return `custom:${c.color}`;
  if (c.kind === "pattern") return `${c.id}:${c.dark ? "d" : "l"}`;
  return c.id;
}

function thumbLabel(c: Candidate): string {
  return c.kind === "pattern" ? (findPattern(c.id)?.label ?? "Doodle") : candidateLabel(c);
}

/** Flat colour shown until the detailed thumbnail is drawn */
function candidateSwatch(c: Candidate, dark: boolean): string {
  if (c.kind === "custom") return c.color;
  if (c.kind === "photo") return "#D1D1D6";
  if (c.kind === "pattern") {
    const p = findPattern(c.id);
    return (dark || c.dark ? p?.darkBg : p?.bg) ?? "#ECE5DD";
  }
  if (c.kind === "gradient") return findGradient(c.id)?.colors[0] ?? "#ECE5DD";
  if (c.kind === "scene") return findScene(c.id)?.color ?? "#ECE5DD";
  if (c.kind === "paper") {
    const pp = findPaper(c.id);
    return (dark ? pp?.darkBg : pp?.bg) ?? "#ECE5DD";
  }
  const w = CHAT_WALLPAPERS.find((x) => x.id === c.id) ?? CHAT_WALLPAPERS[0];
  return dark ? w.darkColor : w.color;
}

/**
 * One wallpaper tile. Memoized so tapping elsewhere doesn't redraw it, and the
 * detailed fill appears after `delay` so opening a grid stays smooth.
 */
const Thumb = React.memo(function Thumb({
  c,
  label,
  selected,
  width,
  dark,
  delay,
  onPick,
  compact = false,
}: {
  c: Candidate;
  label: string;
  selected: boolean;
  width: number;
  dark: boolean;
  delay: number;
  onPick: (c: Candidate) => void;
  compact?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const height = compact ? width * 1.56 : width * 1.78;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onPick(c)}
      style={[compact ? styles.quickItem : styles.thumbItem, { width }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View
        style={[
          compact ? styles.quickThumb : styles.thumb,
          { width, height, backgroundColor: candidateSwatch(c, dark) },
          selected && styles.thumbOn,
        ]}
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
      >
        {ready ? (
          <WallpaperFill c={c} width={width} height={height} dark={dark} cell={compact ? 26 : 34} />
        ) : null}
        {selected ? (
          <View style={styles.thumbCheck}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <Text
        style={compact ? styles.quickLabel : [styles.thumbLabel, selected && styles.thumbLabelOn]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
});

function sameCandidate(a: Candidate, b: Candidate): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "photo" || b.kind === "photo") return false;
  if (a.kind === "custom" || b.kind === "custom") return false;
  if (a.kind === "pattern" && b.kind === "pattern") return a.id === b.id && a.dark === b.dark;
  return a.id === b.id;
}

/** Bubble colour this candidate would give when bubbles are on "auto" */
function candidateBubble(c: Candidate, prefs: A11yPrefs): string {
  const next: A11yPrefs =
    c.kind === "photo"
      ? { ...prefs, chatWallpaper: "photo", chatWallpaperUri: c.uri }
      : c.kind === "custom"
        ? { ...prefs, chatWallpaper: "custom", wallpaperCustom: c.color }
        : { ...prefs, chatWallpaper: c.id };
  if (c.kind === "gradient") return findGradient(c.id)?.bubble ?? myBubbleColor(prefs);
  if (c.kind === "paper") return findPaper(c.id)?.bubble ?? myBubbleColor(prefs);
  if (c.kind === "scene") return findScene(c.id)?.bubble ?? myBubbleColor(prefs);
  if (c.kind === "pattern") {
    return autoBubbleColor({
      ...next,
      bubbleColor: "auto",
      wallpaperDark: c.dark,
    });
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
  if (c.kind === "scene") {
    const sc = findScene(c.id);
    return sc ? <SceneWallpaper scene={sc} dark={dark} /> : null;
  }
  if (c.kind === "paper") {
    const pp = findPaper(c.id);
    return pp ? (
      <PaperWallpaper
        paper={pp}
        width={width}
        height={height}
        dark={dark}
        scale={Math.min(1, width / 260)}
      />
    ) : null;
  }
  if (c.kind === "gradient") {
    const g = findGradient(c.id);
    return g ? (
      <ChatGradientWallpaper gradient={g} width={width} height={height} dark={dark} cell={cell} />
    ) : null;
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
          <View
            style={[styles.phoneAvatar, { width: 16 * s, height: 16 * s, borderRadius: 8 * s }]}
          />
          <View style={[styles.phoneLine, { width: 52 * s, height: 6 * s, borderRadius: 3 * s }]} />
        </View>
      ) : null}
      <View style={[styles.phoneBody, { padding: 8 * s, gap: 6 * s }]}>
        {(
          [
            { me: false, w: 92, line: 64 },
            { me: true, w: 78, line: 50 },
            { me: false, w: 64, line: 40 },
            { me: true, w: 96, line: 70 },
          ] as const
        ).map((b, i) => (
          <View
            key={i}
            style={[
              styles.mockBubble,
              !b.me && styles.mockOther,
              b.me && { backgroundColor: bubble },
              {
                width: b.w * s,
                height: 22 * s,
                borderRadius: 8 * s,
                justifyContent: "center",
                paddingHorizontal: 8 * s,
              },
            ]}
          >
            <View
              style={[
                styles.mockText,
                {
                  width: b.line * s,
                  backgroundColor: b.me ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.14)",
                },
              ]}
            />
          </View>
        ))}
      </View>
      {showChrome ? (
        <View
          style={[styles.phoneInput, { height: 20 * s, margin: 8 * s, borderRadius: 10 * s }]}
        />
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
  const gridItems = GRID_ITEMS[view];
  const [contentW, setContentW] = useState(0);
  const thumbW = Math.floor(((contentW || winW) - 32 - 24) / 3) - 1;

  const goBack = () => {
    if (SUB_VIEWS.includes(view)) setView("categories");
    else if (view !== "home") setView("home");
    else router.back();
  };

  useEffect(() => {
    if (view === "home") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setView(SUB_VIEWS.includes(view) ? "categories" : "home");
      return true;
    });
    return () => sub.remove();
  }, [view]);

  const applyCandidate = async (c: Candidate) => {
    const oldPhoto = prefs.chatWallpaperUri;
    if (c.kind === "photo") {
      setBusy(true);
      try {
        await FileSystem.makeDirectoryAsync(WALLPAPER_DIR, {
          intermediates: true,
        }).catch(() => {});
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
        if (c.kind !== "solid") setPref("bubbleColor", "auto");
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

  const bubbleOptions: {
    id: A11yPrefs["bubbleColor"];
    label: string;
    color: string;
    icon?: keyof typeof Ionicons.glyphMap;
  }[] = [
    {
      id: "auto",
      label: "Auto",
      color: autoBubbleColor(prefs),
      icon: "sparkles",
    },
    ...BUBBLE_COLORS.map((b) => ({
      id: b.id,
      label: b.label,
      color: isDark ? (b.darkColor ?? b.color) : b.color,
    })),
    {
      id: "custom",
      label: "Custom",
      color: prefs.bubbleCustom,
      icon: "color-palette",
    },
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
        onLayout={(e) => setContentW(Math.round(e.nativeEvent.layout.width))}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
      >
        {view === "home" ? (
          <>
            <View style={styles.previewWrap}>
              <View
                style={[
                  styles.phoneShadow,
                  { borderRadius: (22 * Math.min(190, winW * 0.46)) / 180 },
                ]}
              >
                <PhonePreview
                  c={current}
                  width={Math.min(190, winW * 0.46)}
                  bubble={myBubbleColor(prefs)}
                  dark={isDark}
                />
              </View>
              <Text style={styles.currentCaption}>CURRENT WALLPAPER</Text>
              <Text style={styles.currentLabel}>{candidateLabel(current)}</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setView("categories")}
                style={styles.changeBtn}
                accessibilityRole="button"
              >
                <Ionicons name="color-palette-outline" size={18} color="#FFFFFF" />
                <Text style={styles.changeText}>Change wallpaper</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Quick picks</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
            >
              {QUICK_PICKS.map((c, i) => (
                <Thumb
                  key={candidateKey(c)}
                  c={c}
                  label={thumbLabel(c)}
                  selected={sameCandidate(c, current)}
                  width={72}
                  dark={isDark}
                  delay={60 + i * 30}
                  onPick={setCandidate}
                  compact
                />
              ))}
            </ScrollView>

            <View style={styles.card}>
              <ListRowTouchable
                style={styles.listRow}
                onPress={() => setView("bubbles")}
                accessibilityRole="button"
              >
                <View style={[styles.iconCircleSm, { backgroundColor: myBubbleColor(prefs) }]}>
                  <Ionicons name="chatbubble" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Bubble colour</Text>
                  <Text style={styles.rowSub}>
                    {bubbleOptions.find((b) => b.id === prefs.bubbleColor)?.label ?? "Black"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
              </ListRowTouchable>
              <View style={styles.cardDivider} />
              <ListRowTouchable
                style={styles.listRow}
                onPress={() => void pickPhoto()}
                accessibilityRole="button"
              >
                <View style={[styles.iconCircleSm, { backgroundColor: "#34A853" }]}>
                  <Ionicons name="images" size={16} color="#FFFFFF" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Choose from photos</Text>
                  <Text style={styles.rowSub}>Use your own picture</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
              </ListRowTouchable>
              {current.kind !== "solid" || current.id !== "classic" ? (
                <>
                  <View style={styles.cardDivider} />
                  <ListRowTouchable
                    style={styles.listRow}
                    onPress={() => void applyCandidate({ kind: "solid", id: "classic" })}
                    accessibilityRole="button"
                  >
                    <View style={[styles.iconCircleSm, { backgroundColor: "#FF3B30" }]}>
                      <Ionicons name="refresh" size={16} color="#FFFFFF" />
                    </View>
                    <View style={styles.rowContent}>
                      <Text style={[styles.rowLabel, styles.resetLabel]}>Reset wallpaper</Text>
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
                {
                  key: "bright",
                  label: "Bright",
                  icon: "sunny",
                  color: "#FF9500",
                },
                { key: "dark", label: "Dark", icon: "moon", color: "#5856D6" },
                {
                  key: "illustrated",
                  label: "Illustrated",
                  icon: "image",
                  color: "#FF9500",
                },
                {
                  key: "themes",
                  label: "Themes",
                  icon: "sparkles",
                  color: "#34C759",
                },
                {
                  key: "paper",
                  label: "Paper",
                  icon: "document-text",
                  color: "#8E8E93",
                },
                {
                  key: "solid",
                  label: "Solid colours",
                  icon: "color-fill",
                  color: "#0A84FF",
                },
                {
                  key: "gradients",
                  label: "Gradients",
                  icon: "color-filter",
                  color: "#AF52DE",
                },
                { key: "art", label: "Art", icon: "brush", color: "#FF2D55" },
                {
                  key: "photo",
                  label: "My photos",
                  icon: "images",
                  color: "#34A853",
                },
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

        {gridItems ? (
          <View style={styles.grid}>
            {gridItems.map((c, i) => (
              <Thumb
                key={candidateKey(c)}
                c={c}
                label={thumbLabel(c)}
                selected={sameCandidate(c, current)}
                width={thumbW}
                dark={isDark}
                delay={30 + i * 22}
                onPick={setCandidate}
              />
            ))}
            {view === "solid" ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setPicker("wallpaper")}
                style={[styles.thumbItem, { width: thumbW }]}
                accessibilityRole="button"
                accessibilityLabel="Custom colour"
              >
                <View
                  style={[
                    styles.thumb,
                    styles.thumbCustom,
                    {
                      width: thumbW,
                      height: thumbW * 1.78,
                      backgroundColor: prefs.wallpaperCustom,
                    },
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
            ) : null}
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
                    <View
                      style={[
                        styles.bubbleSwatch,
                        { backgroundColor: b.color },
                        on && styles.bubbleSwatchOn,
                      ]}
                    >
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
              Auto matches your wallpaper. Picking any wallpaper except a solid colour or photo
              turns it on.
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
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: candidateSwatch(candidate, isDark) },
              ]}
            />
            <DeferredMount key={candidateKey(candidate)} delay={120}>
              <WallpaperFill c={candidate} width={winW} height={winH} dark={isDark} />
            </DeferredMount>
            <View style={[styles.fullHeader, { paddingTop: insets.top + 2 }]}>
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
                <Text style={styles.fullBubbleText}>
                  This is how {candidateLabel(candidate)} looks 👀
                </Text>
              </View>
              <View
                style={[
                  styles.fullBubble,
                  styles.fullBubbleMe,
                  { backgroundColor: candidateBubble(candidate, prefs) },
                ]}
              >
                <Text style={[styles.fullBubbleText, styles.fullBubbleTextMe]}>
                  Looks great, setting it now
                </Text>
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
      paddingTop: 2,
      paddingBottom: 8,
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
    scroll: { paddingTop: 4 },

    previewWrap: { alignItems: "center", paddingTop: 10, paddingBottom: 22 },
    phoneShadow: {
      borderRadius: 26,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
      backgroundColor: WA.white,
    },
    currentCaption: {
      marginTop: 18,
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 1,
      color: WA.secondary,
    },
    currentLabel: {
      marginTop: 4,
      fontSize: 18,
      fontWeight: "700",
      color: WA.text,
    },
    changeBtn: {
      marginTop: 14,
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 26,
      height: 46,
      borderRadius: 23,
      backgroundColor: "#111111",
      justifyContent: "center",
      alignItems: "center",
    },
    changeText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },

    sectionTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: WA.secondary,
      paddingHorizontal: 20,
      marginBottom: 10,
    },
    quickRow: { paddingHorizontal: 16, gap: 12, paddingBottom: 4 },
    quickItem: { width: 72, alignItems: "center", gap: 6 },
    quickThumb: {
      width: 72,
      height: 112,
      borderRadius: 12,
      overflow: "hidden",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(0,0,0,0.12)",
    },
    quickLabel: { fontSize: 12, color: WA.secondary, maxWidth: 72 },

    card: {
      marginHorizontal: 16,
      marginTop: 22,
      borderRadius: 16,
      overflow: "hidden",
      backgroundColor: WA.white,
    },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: WA.border,
      marginLeft: 64,
    },
    iconCircleSm: {
      width: 32,
      height: 32,
      borderRadius: 10,
      justifyContent: "center",
      alignItems: "center",
    },
    resetLabel: { color: "#FF3B30" },
    mockText: { height: 4, borderRadius: 2 },

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
    groupTop: { marginTop: 4 },
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
    bubbleItem: {
      width: "25%",
      alignItems: "center",
      paddingVertical: 10,
      gap: 6,
    },
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
      paddingBottom: 8,
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
    fullBody: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 12,
      gap: 6,
    },
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
      backgroundColor: "#111111",
      justifyContent: "center",
      alignItems: "center",
    },
    setText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  }),
);
