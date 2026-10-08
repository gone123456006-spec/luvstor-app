import type { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

/** Ionicons name, or a MaterialCommunityIcons name prefixed with "mci:" */
export type PatternIcon =
  | keyof typeof Ionicons.glyphMap
  | `mci:${keyof typeof MaterialCommunityIcons.glyphMap}`;
type IconName = PatternIcon;

export type ChatPatternId =
  | "doodle"
  | "flowers"
  | "hearts"
  | "garden"
  | "space"
  | "pets"
  | "sweets"
  | "music"
  | "clouds"
  | "fun"
  | "webhero"
  | "heroes";

export type ChatPattern = {
  id: ChatPatternId;
  label: string;
  bg: string;
  /** Main and accent ink for the doodles */
  ink: string;
  ink2: string;
  darkBg: string;
  darkInk: string;
  darkInk2: string;
  /** Matching bubble colour when bubbles are on "auto" */
  bubble: string;
  darkBubble: string;
  icons: IconName[];
  /** Tiny filler marks between the doodles */
  fillers: IconName[];
};

const DOTS: IconName[] = ["ellipse", "sparkles", "add"];

/** Doodle wallpapers drawn from tiled icons */
export const CHAT_PATTERNS: ChatPattern[] = [
  {
    id: "doodle",
    label: "Doodle",
    bg: "#ECE5DD",
    ink: "rgba(84,62,40,0.16)",
    ink2: "rgba(84,62,40,0.10)",
    darkBg: "#0C0B10",
    darkInk: "rgba(255,255,255,0.08)",
    darkInk2: "rgba(255,255,255,0.05)",
    bubble: "#111111",
    darkBubble: "#2B2738",
    icons: [
      "happy-outline",
      "heart-outline",
      "star-outline",
      "cafe-outline",
      "camera-outline",
      "musical-note-outline",
      "game-controller-outline",
      "paw-outline",
      "balloon-outline",
      "gift-outline",
      "chatbubble-ellipses-outline",
      "planet-outline",
      "bicycle-outline",
      "pizza-outline",
    ],
    fillers: DOTS,
  },
  {
    id: "flowers",
    label: "Flowers",
    bg: "#FDE7EF",
    ink: "rgba(216,27,96,0.20)",
    ink2: "rgba(67,160,71,0.16)",
    darkBg: "#24161B",
    darkInk: "rgba(255,128,171,0.16)",
    darkInk2: "rgba(129,199,132,0.12)",
    bubble: "#C2185B",
    darkBubble: "#AD1457",
    icons: ["flower", "rose", "flower-outline", "rose-outline", "leaf-outline", "leaf", "flower"],
    fillers: ["ellipse", "sparkles", "heart"],
  },
  {
    id: "hearts",
    label: "Hearts",
    bg: "#FFEDEE",
    ink: "rgba(229,57,53,0.20)",
    ink2: "rgba(236,64,122,0.14)",
    darkBg: "#23151A",
    darkInk: "rgba(255,138,128,0.16)",
    darkInk2: "rgba(244,143,177,0.11)",
    bubble: "#C62828",
    darkBubble: "#B71C1C",
    icons: ["heart", "heart-outline", "heart-half", "heart-circle-outline", "mail-outline", "sparkles-outline"],
    fillers: ["ellipse", "sparkles", "heart"],
  },
  {
    id: "garden",
    label: "Garden",
    bg: "#E9F6EC",
    ink: "rgba(46,125,50,0.20)",
    ink2: "rgba(249,168,37,0.20)",
    darkBg: "#11201A",
    darkInk: "rgba(129,199,132,0.15)",
    darkInk2: "rgba(255,213,79,0.12)",
    bubble: "#2E7D32",
    darkBubble: "#2E7D32",
    icons: ["leaf", "leaf-outline", "flower-outline", "sunny-outline", "rainy-outline", "bug-outline", "nutrition-outline"],
    fillers: ["ellipse", "water", "sparkles"],
  },
  {
    id: "space",
    label: "Space",
    bg: "#1B1640",
    ink: "rgba(255,255,255,0.20)",
    ink2: "rgba(179,157,219,0.30)",
    darkBg: "#120E2C",
    darkInk: "rgba(255,255,255,0.15)",
    darkInk2: "rgba(179,157,219,0.22)",
    bubble: "#7C4DFF",
    darkBubble: "#6A3DE8",
    icons: ["planet", "rocket", "planet-outline", "moon", "star", "rocket-outline", "telescope-outline"],
    fillers: ["star", "ellipse", "sparkles"],
  },
  {
    id: "pets",
    label: "Pets",
    bg: "#EFE9F7",
    ink: "rgba(103,58,183,0.18)",
    ink2: "rgba(255,112,67,0.16)",
    darkBg: "#1C1729",
    darkInk: "rgba(179,157,219,0.15)",
    darkInk2: "rgba(255,171,145,0.12)",
    bubble: "#5B2A9E",
    darkBubble: "#5B2A9E",
    icons: ["paw", "paw-outline", "fish", "fish-outline", "happy-outline", "heart-outline", "football-outline"],
    fillers: ["ellipse", "paw", "sparkles"],
  },
  {
    id: "sweets",
    label: "Sweets",
    bg: "#FFF1E0",
    ink: "rgba(239,108,0,0.20)",
    ink2: "rgba(216,27,96,0.14)",
    darkBg: "#241A14",
    darkInk: "rgba(255,183,77,0.15)",
    darkInk2: "rgba(244,143,177,0.11)",
    bubble: "#E65100",
    darkBubble: "#D84315",
    icons: ["ice-cream", "ice-cream-outline", "pizza-outline", "cafe", "gift-outline", "beer-outline", "fast-food-outline"],
    fillers: ["ellipse", "sparkles", "heart"],
  },
  {
    id: "music",
    label: "Music",
    bg: "#E5F0FC",
    ink: "rgba(21,101,192,0.18)",
    ink2: "rgba(142,36,170,0.14)",
    darkBg: "#121B24",
    darkInk: "rgba(144,202,249,0.15)",
    darkInk2: "rgba(206,147,216,0.11)",
    bubble: "#1565C0",
    darkBubble: "#1565C0",
    icons: ["musical-notes", "musical-note", "headset-outline", "radio-outline", "mic-outline", "disc-outline", "musical-notes-outline"],
    fillers: ["ellipse", "musical-note", "sparkles"],
  },
  {
    id: "clouds",
    label: "Clouds",
    bg: "#E2F4FB",
    ink: "rgba(2,136,209,0.18)",
    ink2: "rgba(255,179,0,0.20)",
    darkBg: "#0F1C24",
    darkInk: "rgba(129,212,250,0.15)",
    darkInk2: "rgba(255,213,79,0.12)",
    bubble: "#0277BD",
    darkBubble: "#0277BD",
    icons: ["cloud", "cloud-outline", "sunny-outline", "airplane-outline", "balloon-outline", "umbrella-outline", "partly-sunny-outline"],
    fillers: ["ellipse", "water", "sparkles"],
  },
  {
    id: "fun",
    label: "Fun",
    bg: "#FFF8DC",
    ink: "rgba(245,127,23,0.20)",
    ink2: "rgba(0,137,123,0.16)",
    darkBg: "#221D10",
    darkInk: "rgba(255,213,79,0.14)",
    darkInk2: "rgba(128,203,196,0.11)",
    bubble: "#00796B",
    darkBubble: "#00796B",
    icons: ["game-controller-outline", "football-outline", "basketball-outline", "dice-outline", "trophy-outline", "happy-outline", "ribbon-outline"],
    fillers: ["ellipse", "star", "sparkles"],
  },
];

CHAT_PATTERNS.push(
  {
    id: "webhero",
    label: "Web Hero",
    bg: "#FDECEC",
    ink: "rgba(198,40,40,0.20)",
    ink2: "rgba(21,101,192,0.18)",
    darkBg: "#1A1016",
    darkInk: "rgba(239,83,80,0.18)",
    darkInk2: "rgba(100,181,246,0.14)",
    bubble: "#C62828",
    darkBubble: "#B71C1C",
    icons: [
      "mci:spider-web",
      "mci:spider",
      "mci:domino-mask",
      "mci:city-variant-outline",
      "mci:spider-web",
      "mci:lightning-bolt-outline",
      "mci:spider",
    ],
    fillers: ["ellipse", "sparkles", "star"],
  },
  {
    id: "heroes",
    label: "Heroes",
    bg: "#E8EDF7",
    ink: "rgba(40,53,147,0.20)",
    ink2: "rgba(198,40,40,0.17)",
    darkBg: "#10131F",
    darkInk: "rgba(121,134,203,0.18)",
    darkInk2: "rgba(239,83,80,0.15)",
    bubble: "#283593",
    darkBubble: "#303F9F",
    icons: [
      "mci:shield-star-outline",
      "mci:lightning-bolt",
      "mci:hammer",
      "mci:shield-star",
      "mci:star-four-points",
      "mci:arm-flex-outline",
      "mci:atom",
      "mci:target",
    ],
    fillers: ["ellipse", "star", "sparkles"],
  },
);

export type GradientId =
  | "g-sunset"
  | "g-aurora"
  | "g-ocean"
  | "g-peach"
  | "g-lavender"
  | "g-mint"
  | "g-candy"
  | "g-golden"
  | "g-berry"
  | "g-nightsky"
  | "g-forest"
  | "g-steel"
  | "a-love"
  | "a-galaxy"
  | "a-bloom"
  | "a-city"
  | "a-melody"
  | "a-summer"
  | "t-cars"
  | "t-flowers"
  | "t-ocean"
  | "t-space"
  | "t-food"
  | "t-love"
  | "t-travel"
  | "t-sports"
  | "t-music"
  | "t-pets"
  | "t-nature"
  | "t-party";

/** A full-colour sticker on a "Themes" wallpaper */
export type Sticker = { icon: PatternIcon; color: string };

export type ChatGradient = {
  id: GradientId;
  label: string;
  colors: [string, string, ...string[]];
  /** Diagonal by default */
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  bubble: string;
  /** Already dark, so it is not dimmed in dark mode */
  dark?: boolean;
  /** "Art": doodles drawn on top in a soft white ink */
  pattern?: ChatPatternId;
  ink?: string;
  /** "Themes": large full-colour stickers with a drop shadow */
  stickers?: Sticker[];
};

/** Gradient and art wallpapers */
export const CHAT_GRADIENTS: ChatGradient[] = [
  { id: "g-sunset", label: "Sunset", colors: ["#FFB199", "#FF7E5F", "#C9516E"], bubble: "#B23A48" },
  { id: "g-aurora", label: "Aurora", colors: ["#A8EDEA", "#7FD8C9", "#6A82FB"], bubble: "#3949AB" },
  { id: "g-ocean", label: "Ocean", colors: ["#D4F1FF", "#7CC6F0", "#2E86C1"], bubble: "#1565C0" },
  { id: "g-peach", label: "Peach", colors: ["#FFF1E6", "#FFD3B6", "#FFAAA5"], bubble: "#D84315" },
  { id: "g-lavender", label: "Lavender", colors: ["#F3E8FF", "#D9C2F0", "#B39DDB"], bubble: "#5B2A9E" },
  { id: "g-mint", label: "Mint", colors: ["#E8FFF3", "#B8F1D5", "#7ED6B0"], bubble: "#00796B" },
  { id: "g-candy", label: "Cotton candy", colors: ["#FFD1E8", "#E2D1FF", "#C2E9FF"], bubble: "#AD1457" },
  { id: "g-golden", label: "Golden hour", colors: ["#FFF3B0", "#FFCF71", "#F4A259"], bubble: "#E65100" },
  { id: "g-berry", label: "Berry", colors: ["#8E2DE2", "#C33764", "#4A00E0"], bubble: "#4A148C", dark: true },
  { id: "g-nightsky", label: "Night sky", colors: ["#0F2027", "#203A43", "#2C5364"], bubble: "#0277BD", dark: true },
  { id: "g-forest", label: "Deep forest", colors: ["#0B3D2E", "#135E46", "#1E8C5A"], bubble: "#2E7D32", dark: true },
  { id: "g-steel", label: "Steel", colors: ["#232526", "#414345", "#5C6066"], bubble: "#546E7A", dark: true },
  {
    id: "a-love",
    label: "Love sunset",
    colors: ["#FF9A9E", "#F6416C", "#A8277A"],
    bubble: "#8E1B4A",
    pattern: "hearts",
    ink: "rgba(255,255,255,0.22)",
  },
  {
    id: "a-galaxy",
    label: "Galaxy",
    colors: ["#1A0B3B", "#3A1C71", "#5F2C82"],
    bubble: "#7C4DFF",
    dark: true,
    pattern: "space",
    ink: "rgba(255,255,255,0.20)",
  },
  {
    id: "a-bloom",
    label: "Bloom",
    colors: ["#FFDDE1", "#FBB6CE", "#F78CA0"],
    bubble: "#C2185B",
    pattern: "flowers",
    ink: "rgba(255,255,255,0.35)",
  },
  {
    id: "a-city",
    label: "Hero city",
    colors: ["#C62828", "#6A1B9A", "#1565C0"],
    bubble: "#0D47A1",
    dark: true,
    pattern: "webhero",
    ink: "rgba(255,255,255,0.18)",
  },
  {
    id: "a-melody",
    label: "Melody",
    colors: ["#4FACFE", "#6A5AE0", "#8E54E9"],
    bubble: "#4527A0",
    dark: true,
    pattern: "music",
    ink: "rgba(255,255,255,0.20)",
  },
  {
    id: "a-summer",
    label: "Summer",
    colors: ["#FFF6B7", "#F6D365", "#FDA085"],
    bubble: "#E65100",
    pattern: "clouds",
    ink: "rgba(255,255,255,0.40)",
  },
  {
    id: "t-cars",
    label: "Cars",
    colors: ["#E3F2FD", "#BBDEFB", "#90CAF9"],
    bubble: "#1565C0",
    stickers: [
      { icon: "mci:car-sports", color: "#E53935" },
      { icon: "mci:car-convertible", color: "#FDD835" },
      { icon: "mci:car-hatchback", color: "#1E88E5" },
      { icon: "mci:traffic-light", color: "#43A047" },
      { icon: "mci:steering", color: "#37474F" },
      { icon: "mci:gas-station", color: "#FB8C00" },
      { icon: "mci:flag-checkered", color: "#212121" },
      { icon: "mci:car-side", color: "#8E24AA" },
    ],
  },
  {
    id: "t-flowers",
    label: "Flowers",
    colors: ["#FFF0F5", "#FFD6E7", "#FBC2D9"],
    bubble: "#C2185B",
    stickers: [
      { icon: "mci:flower-tulip", color: "#EC407A" },
      { icon: "mci:flower", color: "#AB47BC" },
      { icon: "mci:flower-poppy", color: "#FF7043" },
      { icon: "mci:butterfly", color: "#26A69A" },
      { icon: "mci:bee", color: "#FBC02D" },
      { icon: "mci:leaf", color: "#66BB6A" },
      { icon: "mci:flower-tulip", color: "#7E57C2" },
    ],
  },
  {
    id: "t-ocean",
    label: "Ocean",
    colors: ["#E0F7FA", "#80DEEA", "#4DD0E1"],
    bubble: "#00838F",
    stickers: [
      { icon: "mci:fish", color: "#FF7043" },
      { icon: "mci:jellyfish", color: "#BA68C8" },
      { icon: "mci:turtle", color: "#43A047" },
      { icon: "mci:dolphin", color: "#1E88E5" },
      { icon: "mci:sail-boat", color: "#F4511E" },
      { icon: "mci:waves", color: "#0288D1" },
      { icon: "mci:anchor", color: "#37474F" },
      { icon: "mci:shark-fin", color: "#546E7A" },
    ],
  },
  {
    id: "t-space",
    label: "Space",
    colors: ["#0B0F2B", "#1A1F4B", "#2E1A47"],
    bubble: "#7C4DFF",
    dark: true,
    stickers: [
      { icon: "mci:rocket-launch", color: "#FF7043" },
      { icon: "mci:orbit", color: "#FFCA28" },
      { icon: "mci:ufo", color: "#4DD0E1" },
      { icon: "mci:star-shooting", color: "#FFF176" },
      { icon: "mci:moon-waning-crescent", color: "#FFE082" },
      { icon: "mci:star", color: "#FFFFFF" },
    ],
  },
  {
    id: "t-food",
    label: "Food",
    colors: ["#FFF8E1", "#FFECB3", "#FFE0B2"],
    bubble: "#E65100",
    stickers: [
      { icon: "mci:pizza", color: "#F4511E" },
      { icon: "mci:hamburger", color: "#8D6E63" },
      { icon: "mci:ice-cream", color: "#F06292" },
      { icon: "mci:food-croissant", color: "#FFA726" },
      { icon: "mci:cupcake", color: "#BA68C8" },
      { icon: "mci:coffee", color: "#6D4C41" },
      { icon: "mci:fruit-watermelon", color: "#E53935" },
      { icon: "mci:fruit-cherries", color: "#C62828" },
    ],
  },
  {
    id: "t-love",
    label: "Love",
    colors: ["#FFE4EC", "#FFC1D6", "#FF9BBF"],
    bubble: "#AD1457",
    stickers: [
      { icon: "mci:heart", color: "#E53935" },
      { icon: "mci:heart-multiple", color: "#EC407A" },
      { icon: "mci:gift", color: "#8E24AA" },
      { icon: "mci:ring", color: "#FFB300" },
      { icon: "mci:cards-heart", color: "#D81B60" },
      { icon: "mci:balloon", color: "#F06292" },
      { icon: "mci:candle", color: "#FF8F00" },
    ],
  },
  {
    id: "t-travel",
    label: "Travel",
    colors: ["#E0F7FA", "#FFF3E0", "#FFE0B2"],
    bubble: "#00897B",
    stickers: [
      { icon: "mci:airplane", color: "#1E88E5" },
      { icon: "mci:beach", color: "#FFB300" },
      { icon: "mci:palm-tree", color: "#43A047" },
      { icon: "mci:camera", color: "#37474F" },
      { icon: "mci:map-marker", color: "#E53935" },
      { icon: "mci:bag-suitcase", color: "#8D6E63" },
      { icon: "mci:island", color: "#26A69A" },
      { icon: "mci:lighthouse", color: "#F4511E" },
    ],
  },
  {
    id: "t-sports",
    label: "Sports",
    colors: ["#E8F5E9", "#C8E6C9", "#A5D6A7"],
    bubble: "#2E7D32",
    stickers: [
      { icon: "mci:soccer", color: "#212121" },
      { icon: "mci:basketball", color: "#FB8C00" },
      { icon: "mci:tennis", color: "#C0CA33" },
      { icon: "mci:trophy", color: "#FFB300" },
      { icon: "mci:bike", color: "#1E88E5" },
      { icon: "mci:flag-checkered", color: "#424242" },
    ],
  },
  {
    id: "t-music",
    label: "Music",
    colors: ["#EDE7F6", "#D1C4E9", "#B39DDB"],
    bubble: "#4527A0",
    stickers: [
      { icon: "mci:guitar-acoustic", color: "#8D6E63" },
      { icon: "mci:headphones", color: "#E53935" },
      { icon: "mci:piano", color: "#212121" },
      { icon: "mci:microphone-variant", color: "#1E88E5" },
      { icon: "mci:music", color: "#8E24AA" },
      { icon: "mci:star", color: "#FFB300" },
    ],
  },
  {
    id: "t-pets",
    label: "Pets",
    colors: ["#FFF3E0", "#FFE0B2", "#FFCC80"],
    bubble: "#6D4C41",
    stickers: [
      { icon: "mci:cat", color: "#FF8A65" },
      { icon: "mci:dog", color: "#8D6E63" },
      { icon: "mci:paw", color: "#5D4037" },
      { icon: "mci:bone", color: "#BDBDBD" },
      { icon: "mci:fish", color: "#29B6F6" },
      { icon: "mci:heart", color: "#EF5350" },
    ],
  },
  {
    id: "t-nature",
    label: "Nature",
    colors: ["#F1F8E9", "#DCEDC8", "#C5E1A5"],
    bubble: "#33691E",
    stickers: [
      { icon: "mci:pine-tree", color: "#2E7D32" },
      { icon: "mci:tree", color: "#43A047" },
      { icon: "mci:mushroom", color: "#E53935" },
      { icon: "mci:weather-sunny", color: "#FFB300" },
      { icon: "mci:cloud", color: "#90CAF9" },
      { icon: "mci:butterfly", color: "#AB47BC" },
      { icon: "mci:leaf", color: "#7CB342" },
    ],
  },
  {
    id: "t-party",
    label: "Party",
    colors: ["#F3E5F5", "#E1BEE7", "#FFCDD2"],
    bubble: "#8E24AA",
    stickers: [
      { icon: "mci:party-popper", color: "#FF7043" },
      { icon: "mci:glass-cocktail", color: "#26C6DA" },
      { icon: "mci:cake", color: "#EC407A" },
      { icon: "mci:firework", color: "#FFCA28" },
      { icon: "mci:balloon", color: "#7E57C2" },
      { icon: "mci:crown", color: "#FFB300" },
      { icon: "mci:emoticon-cool", color: "#FDD835" },
      { icon: "mci:diamond-stone", color: "#29B6F6" },
    ],
  },
];

export function findGradient(id: string): ChatGradient | undefined {
  return CHAT_GRADIENTS.find((g) => g.id === id);
}

/** Gradient colours for the current theme (light gradients are dimmed in dark mode) */
export function gradientColors(g: ChatGradient, dark: boolean): [string, string, ...string[]] {
  if (!dark || g.dark) return g.colors;
  return g.colors.map((c) => mixHex(c, "#0B0B10", 0.62)) as [string, string, ...string[]];
}

export function findPattern(id: string): ChatPattern | undefined {
  return CHAT_PATTERNS.find((p) => p.id === id);
}

export type BubbleColorId =
  | "auto"
  | "custom"
  | "black"
  | "purple"
  | "violet"
  | "rose"
  | "red"
  | "orange"
  | "teal"
  | "green"
  | "blue"
  | "navy"
  | "brown"
  | "slate";

/** Fixed colours for your own message bubbles (all dark enough for white text) */
export const BUBBLE_COLORS: {
  id: Exclude<BubbleColorId, "auto" | "custom">;
  label: string;
  color: string;
  darkColor?: string;
}[] = [
  { id: "black", label: "Black", color: "#111111", darkColor: "#2B2738" },
  { id: "purple", label: "Luvstor", color: "#370372", darkColor: "#5A2EA6" },
  { id: "violet", label: "Violet", color: "#5B2A9E" },
  { id: "rose", label: "Rose", color: "#C2185B" },
  { id: "red", label: "Red", color: "#C62828" },
  { id: "orange", label: "Orange", color: "#E65100" },
  { id: "teal", label: "Teal", color: "#00796B" },
  { id: "green", label: "Green", color: "#2E7D32" },
  { id: "blue", label: "Blue", color: "#1565C0" },
  { id: "navy", label: "Navy", color: "#283593" },
  { id: "brown", label: "Brown", color: "#5D4037" },
  { id: "slate", label: "Slate", color: "#455A64" },
];

function toHex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, "0");
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Blend `a` toward `b` by `t` (0 = a, 1 = b) */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  return `#${toHex(r1 + (r2 - r1) * t)}${toHex(g1 + (g2 - g1) * t)}${toHex(b1 + (b2 - b1) * t)}`.toUpperCase();
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${toHex(f(0) * 255)}${toHex(f(8) * 255)}${toHex(f(4) * 255)}`.toUpperCase();
}

const HUES = [0, 20, 35, 50, 90, 140, 170, 195, 215, 240, 265, 290, 320, 340];

/** Picker grid: rows of shades, columns of hues, plus a grey row */
export function colorGrid(kind: "wallpaper" | "bubble"): string[][] {
  const rows =
    kind === "wallpaper"
      ? [
          [70, 94],
          [65, 88],
          [55, 80],
          [45, 70],
          [35, 22],
          [30, 14],
        ]
      : [
          [70, 48],
          [65, 40],
          [60, 33],
          [55, 26],
          [50, 20],
        ];
  const grid = rows.map(([s, l]) => HUES.map((h) => hslToHex(h, s, l)));
  const greys =
    kind === "wallpaper"
      ? [98, 94, 90, 84, 76, 66, 54, 42, 32, 24, 18, 13, 9, 6]
      : [48, 42, 36, 31, 27, 23, 20, 17, 14, 12, 10, 8, 6, 4];
  grid.push(greys.map((l) => hslToHex(0, 0, l)));
  return grid;
}

/** True when dark text reads better than white on this colour */
export function isLightColor(hex: string): boolean {
  const [r, g, b] = parseHex(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}
