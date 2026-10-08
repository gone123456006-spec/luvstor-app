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
