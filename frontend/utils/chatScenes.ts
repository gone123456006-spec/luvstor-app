import type { ImageSourcePropType } from "react-native";

export type PaperId = "p-notebook" | "p-kraft" | "p-grid" | "p-dots" | "p-gold";

export type ChatPaper = {
  id: PaperId;
  label: string;
  kind: "lines" | "grid" | "dots" | "chevron";
  bg: string;
  ink: string;
  /** Notebook margin line */
  margin?: string;
  holes?: boolean;
  darkBg: string;
  darkInk: string;
  darkMargin?: string;
  bubble: string;
};

/** Stationery wallpapers drawn in code */
export const CHAT_PAPERS: ChatPaper[] = [
  {
    id: "p-notebook",
    label: "Notebook",
    kind: "lines",
    bg: "#FDFBF4",
    ink: "rgba(66,133,244,0.28)",
    margin: "rgba(229,57,53,0.45)",
    holes: true,
    darkBg: "#18181C",
    darkInk: "rgba(144,202,249,0.14)",
    darkMargin: "rgba(239,83,80,0.32)",
    bubble: "#1565C0",
  },
  {
    id: "p-kraft",
    label: "Kraft",
    kind: "lines",
    bg: "#E6D2AE",
    ink: "rgba(93,64,55,0.20)",
    margin: "rgba(183,28,28,0.30)",
    darkBg: "#211B13",
    darkInk: "rgba(215,204,200,0.10)",
    darkMargin: "rgba(239,83,80,0.22)",
    bubble: "#5D4037",
  },
  {
    id: "p-grid",
    label: "Grid paper",
    kind: "grid",
    bg: "#F7FAFF",
    ink: "rgba(30,136,229,0.16)",
    darkBg: "#141820",
    darkInk: "rgba(144,202,249,0.10)",
    bubble: "#283593",
  },
  {
    id: "p-dots",
    label: "Dot journal",
    kind: "dots",
    bg: "#FBF8F3",
    ink: "rgba(0,0,0,0.22)",
    darkBg: "#17171A",
    darkInk: "rgba(255,255,255,0.14)",
    bubble: "#111111",
  },
  {
    id: "p-gold",
    label: "Gold wall",
    kind: "chevron",
    bg: "#D8C26A",
    ink: "rgba(110,88,20,0.22)",
    darkBg: "#2A2412",
    darkInk: "rgba(216,194,106,0.16)",
    bubble: "#6D4C41",
  },
];

export type SceneId =
  | "i-glow-pup"
  | "i-misty-quest"
  | "i-hero-crest"
  | "i-felt-garden"
  | "i-toy-car"
  | "i-deep-water"
  | "i-cosmo-float"
  | "i-sakura-breeze"
  | "i-sweet-treats"
  | "i-cozy-cat"
  | "i-neon-night"
  | "i-golden-dunes"
  | "i-sky-swinger"
  | "i-nova-armor"
  | "i-magma-titan";

export type ChatScene = {
  id: SceneId;
  label: string;
  source: ImageSourcePropType;
  /** Fallback colour while loading and for dimming */
  color: string;
  bubble: string;
  dark?: boolean;
};

/** Illustrated wallpapers bundled as images */
export const CHAT_SCENES: ChatScene[] = [
  {
    id: "i-glow-pup",
    label: "Glow Pup",
    source: require("../assets/wallpapers/glow-pup.jpg"),
    color: "#E9E0F5",
    bubble: "#7B1FA2",
  },
  {
    id: "i-misty-quest",
    label: "Misty Quest",
    source: require("../assets/wallpapers/misty-quest.jpg"),
    color: "#9DB5AC",
    bubble: "#00695C",
    dark: true,
  },
  {
    id: "i-hero-crest",
    label: "Hero Crest",
    source: require("../assets/wallpapers/hero-crest.jpg"),
    color: "#1638A8",
    bubble: "#B71C1C",
    dark: true,
  },
  {
    id: "i-felt-garden",
    label: "Felt Garden",
    source: require("../assets/wallpapers/felt-garden.jpg"),
    color: "#EBC4C4",
    bubble: "#558B2F",
  },
  {
    id: "i-toy-car",
    label: "Toy Car",
    source: require("../assets/wallpapers/toy-car.jpg"),
    color: "#F8D9CC",
    bubble: "#C62828",
  },
  {
    id: "i-deep-water",
    label: "Deep Water",
    source: require("../assets/wallpapers/deep-water.jpg"),
    color: "#2FA3B8",
    bubble: "#006064",
    dark: true,
  },
  {
    id: "i-cosmo-float",
    label: "Cosmo Float",
    source: require("../assets/wallpapers/cosmo-float.jpg"),
    color: "#2E2470",
    bubble: "#6A1B9A",
    dark: true,
  },
  {
    id: "i-sakura-breeze",
    label: "Sakura Breeze",
    source: require("../assets/wallpapers/sakura-breeze.jpg"),
    color: "#F8DCE0",
    bubble: "#C2185B",
  },
  {
    id: "i-sweet-treats",
    label: "Sweet Treats",
    source: require("../assets/wallpapers/sweet-treats.jpg"),
    color: "#CFEBDD",
    bubble: "#AD1457",
  },
  {
    id: "i-cozy-cat",
    label: "Cozy Cat",
    source: require("../assets/wallpapers/cozy-cat.jpg"),
    color: "#F3D3B8",
    bubble: "#BF5B2C",
  },
  {
    id: "i-neon-night",
    label: "Neon Night",
    source: require("../assets/wallpapers/neon-night.jpg"),
    color: "#2A1846",
    bubble: "#8E24AA",
    dark: true,
  },
  {
    id: "i-golden-dunes",
    label: "Golden Dunes",
    source: require("../assets/wallpapers/golden-dunes.jpg"),
    color: "#F2C9A0",
    bubble: "#BF5B2C",
  },
  {
    id: "i-sky-swinger",
    label: "Sky Swinger",
    source: require("../assets/wallpapers/sky-swinger.jpg"),
    color: "#5B3A7A",
    bubble: "#00796B",
    dark: true,
  },
  {
    id: "i-nova-armor",
    label: "Nova Armor",
    source: require("../assets/wallpapers/nova-armor.jpg"),
    color: "#0A1A3A",
    bubble: "#1565C0",
    dark: true,
  },
  {
    id: "i-magma-titan",
    label: "Magma Titan",
    source: require("../assets/wallpapers/magma-titan.jpg"),
    color: "#A8401C",
    bubble: "#4E342E",
    dark: true,
  },
];

export function findPaper(id: string): ChatPaper | undefined {
  return CHAT_PAPERS.find((p) => p.id === id);
}

export function findScene(id: string): ChatScene | undefined {
  return CHAT_SCENES.find((s) => s.id === id);
}
