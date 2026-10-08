import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AccessibilityInfo, Appearance } from "react-native";
import { a11yState } from "../utils/a11yState";
import {
  BUBBLE_COLORS,
  type BubbleColorId,
  type ChatPatternId,
  findGradient,
  findPattern,
  type GradientId,
  mixHex,
} from "../utils/chatPatterns";
import { findPaper, findScene, type PaperId, type SceneId } from "../utils/chatScenes";
import { themeState } from "../utils/theme";

export type ChatTextSize = "small" | "default" | "large" | "xlarge";

export type ChatWallpaperId =
  | "classic"
  | "light"
  | "lavender"
  | "blush"
  | "mint"
  | "sky"
  | "peach"
  | "midnight"
  | "cream"
  | "sand"
  | "lilac"
  | "rosewater"
  | "aqua"
  | "sage"
  | "grey"
  | "ocean"
  | "forest"
  | "plum"
  | "wine"
  | "navy"
  | "charcoal"
  | ChatPatternId
  | GradientId
  | PaperId
  | SceneId
  | "custom"
  | "photo";

export type ThemeMode = "system" | "light" | "dark";

export type A11yPrefs = {
  themeMode: ThemeMode;
  chatTextSize: ChatTextSize;
  boldChatText: boolean;
  /** Bolder weight for every text style in the app */
  boldAll: boolean;
  /** null = follow the phone's Reduce Motion setting */
  reduceMotion: boolean | null;
  haptics: boolean;
  chatWallpaper: ChatWallpaperId;
  /** Local file for the "photo" wallpaper */
  chatWallpaperUri: string | null;
  /** Colour of your own message bubbles ("auto" follows the wallpaper) */
  bubbleColor: BubbleColorId;
  /** Doodle wallpapers: always use the night version (the "Dark" category) */
  wallpaperDark: boolean;
  /** Picked colour for the "custom" wallpaper */
  wallpaperCustom: string;
  /** Picked colour for "custom" bubbles */
  bubbleCustom: string;
};

export const CHAT_TEXT_SIZES: Record<
  ChatTextSize,
  { label: string; fontSize: number; lineHeight: number }
> = {
  small: { label: "Small", fontSize: 13.5, lineHeight: 18 },
  default: { label: "Default", fontSize: 15.5, lineHeight: 20.5 },
  large: { label: "Large", fontSize: 17.5, lineHeight: 23 },
  xlarge: { label: "Extra large", fontSize: 20, lineHeight: 26 },
};

export const CHAT_WALLPAPERS: {
  id: Exclude<
    ChatWallpaperId,
    "photo" | "custom" | ChatPatternId | GradientId | PaperId | SceneId
  >;
  label: string;
  color: string;
  /** Used while the app is in dark mode */
  darkColor: string;
  /** Matching bubble colour for "auto" */
  bubble: string;
  dark?: boolean;
}[] = [
  { id: "classic", label: "Classic", color: "#ECE5DD", darkColor: "#0C0B10", bubble: "#111111" },
  { id: "light", label: "Light", color: "#F5F5F7", darkColor: "#0F0F13", bubble: "#370372" },
  { id: "lavender", label: "Lavender", color: "#EFE8F8", darkColor: "#1C1729", bubble: "#5B2A9E" },
  { id: "blush", label: "Blush", color: "#FCE4EC", darkColor: "#24161B", bubble: "#C2185B" },
  { id: "mint", label: "Mint", color: "#E3F4EC", darkColor: "#12201A", bubble: "#00796B" },
  { id: "sky", label: "Sky", color: "#E3F0FB", darkColor: "#121B24", bubble: "#1565C0" },
  { id: "peach", label: "Peach", color: "#FFE9DC", darkColor: "#241A14", bubble: "#E65100" },
  { id: "cream", label: "Cream", color: "#FFF8E1", darkColor: "#221E12", bubble: "#E65100" },
  { id: "sand", label: "Sand", color: "#F1E4D3", darkColor: "#211B14", bubble: "#5D4037" },
  { id: "lilac", label: "Lilac", color: "#E6DDF7", darkColor: "#1E1830", bubble: "#5B2A9E" },
  { id: "rosewater", label: "Rosewater", color: "#F8D7DA", darkColor: "#28171A", bubble: "#C62828" },
  { id: "aqua", label: "Aqua", color: "#D9F2F2", darkColor: "#102222", bubble: "#00796B" },
  { id: "sage", label: "Sage", color: "#DDE8D5", darkColor: "#161F12", bubble: "#2E7D32" },
  { id: "grey", label: "Grey", color: "#E4E6EB", darkColor: "#18191D", bubble: "#455A64" },
  {
    id: "midnight",
    label: "Midnight",
    color: "#231C35",
    darkColor: "#231C35",
    bubble: "#7C4DFF",
    dark: true,
  },
  { id: "ocean", label: "Ocean", color: "#0E2A3B", darkColor: "#0E2A3B", bubble: "#0288D1", dark: true },
  { id: "forest", label: "Forest", color: "#17301F", darkColor: "#17301F", bubble: "#2E7D32", dark: true },
  { id: "plum", label: "Plum", color: "#3A1C3F", darkColor: "#3A1C3F", bubble: "#8E24AA", dark: true },
  { id: "wine", label: "Wine", color: "#3B1418", darkColor: "#3B1418", bubble: "#C62828", dark: true },
  { id: "navy", label: "Navy", color: "#13213D", darkColor: "#13213D", bubble: "#3949AB", dark: true },
  {
    id: "charcoal",
    label: "Charcoal",
    color: "#22252A",
    darkColor: "#22252A",
    bubble: "#546E7A",
    dark: true,
  },
];

const DEFAULTS: A11yPrefs = {
  themeMode: "light",
  chatTextSize: "default",
  boldChatText: false,
  boldAll: false,
  reduceMotion: null,
  haptics: true,
  chatWallpaper: "classic",
  chatWallpaperUri: null,
  bubbleColor: "black",
  wallpaperDark: false,
  wallpaperCustom: "#D7E8F5",
  bubbleCustom: "#8E24AA",
};

const STORAGE_KEY = "luvstor:a11y:v1";
/** Never hold the splash longer than this waiting for storage */
const LOAD_TIMEOUT_MS = 500;

type Ctx = {
  prefs: A11yPrefs;
  /** Effective value: explicit pref, else the phone setting */
  reduceMotion: boolean;
  systemReduceMotion: boolean;
  setPref: <K extends keyof A11yPrefs>(key: K, value: A11yPrefs[K]) => void;
  reset: () => void;
  /** Effective theme */
  isDark: boolean;
  /** Bumped to remount the navigator so app-wide style changes apply everywhere */
  uiKey: number;
  /** Screen to reopen after the remount */
  returnTo: string | null;
  remountApp: (returnTo?: string | null) => void;
  /** True while the navigator is rebuilding after a remount; transitions stay off */
  restoring: boolean;
  finishRestore: () => void;
};

const AccessibilityContext = createContext<Ctx | null>(null);

function resolveDark(mode: ThemeMode): boolean {
  if (mode === "system") return Appearance.getColorScheme() === "dark";
  return mode === "dark";
}

themeState.dark = resolveDark(DEFAULTS.themeMode);

function syncModuleState(p: A11yPrefs) {
  a11yState.haptics = p.haptics;
  a11yState.boldAll = p.boldAll;
  themeState.dark = resolveDark(p.themeMode);
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULTS);
  const prefsRef = useRef<A11yPrefs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [uiKey, setUiKey] = useState(0);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [restoredKey, setRestoredKey] = useState(0);
  const restoring = !!returnTo && restoredKey !== uiKey;
  const [isDark, setIsDark] = useState(() => resolveDark(DEFAULTS.themeMode));

  useEffect(() => {
    let alive = true;
    const done = () => alive && setLoaded(true);
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const next = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
        prefsRef.current = next;
        syncModuleState(next);
        setIsDark(themeState.dark);
        setPrefs(next);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        done();
      });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => alive && setSystemReduceMotion(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setSystemReduceMotion,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  // Phone switched light/dark while following the system
  useEffect(() => {
    const sub = Appearance.addChangeListener(() => {
      const dark = resolveDark(prefsRef.current.themeMode);
      if (dark === themeState.dark) return;
      themeState.dark = dark;
      setIsDark(dark);
      setReturnTo(null);
      setUiKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

  const persist = useCallback((next: A11yPrefs) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const setPref = useCallback(
    <K extends keyof A11yPrefs>(key: K, value: A11yPrefs[K]) => {
      const next = { ...prefsRef.current, [key]: value };
      prefsRef.current = next;
      syncModuleState(next);
      setIsDark(themeState.dark);
      setPrefs(next);
      persist(next);
    },
    [persist],
  );

  /** Resets accessibility options; theme and wallpaper are kept */
  const reset = useCallback(() => {
    const wasBold = a11yState.boldAll;
    const cur = prefsRef.current;
    const next: A11yPrefs = {
      ...DEFAULTS,
      themeMode: cur.themeMode,
      chatWallpaper: cur.chatWallpaper,
      chatWallpaperUri: cur.chatWallpaperUri,
      bubbleColor: cur.bubbleColor,
      wallpaperDark: cur.wallpaperDark,
      wallpaperCustom: cur.wallpaperCustom,
      bubbleCustom: cur.bubbleCustom,
    };
    prefsRef.current = next;
    syncModuleState(next);
    setPrefs(next);
    persist(next);
    if (wasBold) {
      setReturnTo("/settings/accessibility");
      setUiKey((k) => k + 1);
    }
  }, [persist]);

  const remountApp = useCallback((path: string | null = null) => {
    setReturnTo(path);
    setUiKey((k) => k + 1);
  }, []);

  const finishRestore = useCallback(() => setRestoredKey(uiKey), [uiKey]);

  const value = useMemo<Ctx>(
    () => ({
      prefs,
      reduceMotion: prefs.reduceMotion ?? systemReduceMotion,
      systemReduceMotion,
      setPref,
      reset,
      isDark,
      uiKey,
      returnTo,
      remountApp,
      restoring,
      finishRestore,
    }),
    [
      prefs,
      systemReduceMotion,
      setPref,
      reset,
      isDark,
      uiKey,
      returnTo,
      remountApp,
      restoring,
      finishRestore,
    ],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {loaded ? children : null}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): Ctx {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be used inside AccessibilityProvider");
  return ctx;
}

/** Doodles render their night version in dark mode or when picked from "Dark" */
export function patternIsDark(prefs: A11yPrefs): boolean {
  return themeState.dark || prefs.wallpaperDark;
}

export function wallpaperColor(prefs: A11yPrefs): string {
  const pattern = findPattern(prefs.chatWallpaper);
  if (pattern) return patternIsDark(prefs) ? pattern.darkBg : pattern.bg;
  const paper = findPaper(prefs.chatWallpaper);
  if (paper) return themeState.dark ? paper.darkBg : paper.bg;
  const scene = findScene(prefs.chatWallpaper);
  if (scene) return scene.color;
  const gradient = findGradient(prefs.chatWallpaper);
  if (gradient) {
    const c = gradient.colors[gradient.colors.length - 1];
    return themeState.dark && !gradient.dark ? mixHex(c, "#0B0B10", 0.62) : c;
  }
  if (prefs.chatWallpaper === "custom") {
    return themeState.dark ? mixHex(prefs.wallpaperCustom, "#0F0F13", 0.82) : prefs.wallpaperCustom;
  }
  const w =
    CHAT_WALLPAPERS.find((x) => x.id === prefs.chatWallpaper) ?? CHAT_WALLPAPERS[0];
  return themeState.dark ? w.darkColor : w.color;
}

/** Bubble colour that matches the current wallpaper */
export function autoBubbleColor(prefs: A11yPrefs): string {
  const pattern = findPattern(prefs.chatWallpaper);
  if (pattern) return patternIsDark(prefs) ? pattern.darkBubble : pattern.bubble;
  const gradient = findGradient(prefs.chatWallpaper);
  if (gradient) return gradient.bubble;
  const paper = findPaper(prefs.chatWallpaper);
  if (paper) return paper.bubble;
  const scene = findScene(prefs.chatWallpaper);
  if (scene) return scene.bubble;
  if (prefs.chatWallpaper === "custom") return mixHex(prefs.wallpaperCustom, "#000000", 0.55);
  const w = CHAT_WALLPAPERS.find((x) => x.id === prefs.chatWallpaper);
  if (!w) return themeState.dark ? "#2B2738" : "#111111";
  if (themeState.dark && w.bubble === "#111111") return "#2B2738";
  return w.bubble;
}

export function myBubbleColor(prefs: A11yPrefs): string {
  if (prefs.bubbleColor === "auto") return autoBubbleColor(prefs);
  if (prefs.bubbleColor === "custom") return prefs.bubbleCustom;
  const b = BUBBLE_COLORS.find((x) => x.id === prefs.bubbleColor) ?? BUBBLE_COLORS[0];
  return themeState.dark ? (b.darkColor ?? b.color) : b.color;
}
