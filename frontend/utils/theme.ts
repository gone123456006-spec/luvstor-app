/**
 * Light / dark theme.
 *
 * Screens keep their light colours in code; in dark mode each colour is mapped
 * by its role (background, text, border). `themeState.dark` is set before the
 * navigator remounts, so render-time reads are always current.
 */
import { StyleSheet } from "react-native";

export const themeState = { dark: false };

export type ColorRole = "bg" | "fg" | "line";

/** Dark palette */
export const D = {
  page: "#0F0F13",
  sheet: "#141418",
  surface: "#1E1E24",
  fill: "#2A2A31",
  line: "#2E2E36",
  text: "#ECECF1",
  text2: "#A7A7B2",
  text3: "#80808B",
  tint: "#2B2240",
  tintLine: "#3A2F55",
  primary: "#9473EC",
  chat: "#0C0B10",
} as const;

const RED_TINT = "#3A1D26";
const AMBER_TINT = "#3A2F16";

const BG: Record<string, string> = {
  "#FFFFFF": D.surface,
  "#F5F5F7": D.page,
  "#F2F2F2": D.page,
  "#F5F5F5": D.page,
  "#FAFAFA": D.page,
  "#F0F2F5": D.page,
  "#FDF8FF": D.page,
  "#F5F6F8": D.sheet,
  "#F0F0F0": D.fill,
  "#E7E0EC": D.fill,
  "#E5E5EA": D.fill,
  "#E0E0E0": D.fill,
  "#D0D0D0": D.fill,
  "#DBDBDB": D.fill,
  "#D1D7DB": D.fill,
  "#CFD8DC": D.fill,
  "#D1D1D6": D.fill,
  "#C7C7CC": D.fill,
  "#E9EDEF": D.fill,
  "#E8E8ED": D.line,
  "#E5E5E5": D.line,
  "#EFEFEF": D.line,
  "#EEEEEE": D.fill,
  "#DFE5E7": D.fill,
  "#E4E6EB": D.fill,
  "#EFE8F8": D.tint,
  "#EADDFF": D.tint,
  "#F3EDF7": D.tint,
  "#EAE2F8": D.tint,
  "#F3E8FF": D.tint,
  "#F3E5F5": D.tint,
  "#E8E0F2": D.tint,
  "#D0C4DC": D.tint,
  "#FFEBEE": RED_TINT,
  "#FFF0F0": RED_TINT,
  "#FFE8EE": RED_TINT,
  "#FFF0F2": RED_TINT,
  "#FDECEA": RED_TINT,
  "#FFF8E6": AMBER_TINT,
  "#E7F8EF": "#16301F",
  "#FFF8E1": AMBER_TINT,
  "#FFF3E0": AMBER_TINT,
  "#DCF8C6": "#1F3A26",
  "#ECE5DD": D.chat,
  "#111111": "#2B2738",
  "#370372": D.primary,
  "#6750A4": "#7A5FC8",
};

const FG: Record<string, string> = {
  "#1C1B1F": D.text,
  "#262626": D.text,
  "#111B21": D.text,
  "#333333": D.text,
  "#111111": D.text,
  "#1A1A1A": D.text,
  "#050505": D.text,
  "#000000": D.text,
  "#49454F": D.text2,
  "#667781": D.text2,
  "#6B7280": D.text2,
  "#65676B": D.text2,
  "#54656F": D.text2,
  "#555555": D.text2,
  "#666666": D.text2,
  "#79747E": D.text3,
  "#8E8E8E": D.text3,
  "#999999": D.text3,
  "#777777": D.text3,
  "#8696A0": D.text3,
  "#3B4A54": D.text2,
  "#9AA3A9": D.text3,
  "#370372": D.primary,
  "#6750A4": D.primary,
  "#4C1D95": D.primary,
};

const LINE: Record<string, string> = {
  "#FFFFFF": D.surface,
  "#E7E0EC": D.line,
  "#E8E8ED": D.line,
  "#DBDBDB": D.line,
  "#E5E5E5": D.line,
  "#E9EDEF": D.line,
  "#EEEEEE": D.line,
  "#EFEFEF": D.line,
  "#F0F0F0": D.line,
  "#E0E0E0": D.line,
  "#CCCCCC": D.line,
  "#C7C7CC": D.line,
  "#CAC4D0": D.line,
  "#F5F5F7": D.page,
  "#79747E": "#4A4A55",
  "#EADDFF": D.tintLine,
  "#E9D5FF": D.tintLine,
  "#FFF0F2": D.tintLine,
  "#370372": D.primary,
};

function normalize(c: string): string {
  const s = c.trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return s;
}

/** Low-alpha black tints (hover/pressed fills, hairlines) flip to white tints */
function darkRgba(c: string, role: ColorRole): string | undefined {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(c.trim());
  if (!m) return undefined;
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (r + g + b <= 60 && a <= 0.15) return `rgba(255,255,255,${Math.min(0.2, a * 1.4).toFixed(2)})`;
  if (role === "bg" && r > 220 && g > 220 && b > 220 && a >= 0.5) return `rgba(20,20,24,${a})`;
  return undefined;
}

/** Dark counterpart of a light colour (unchanged when not mapped) */
export function toDark(color: string, role: ColorRole): string {
  const rgba = darkRgba(color, role);
  if (rgba) return rgba;
  const key = normalize(color);
  const table = role === "bg" ? BG : role === "fg" ? FG : LINE;
  return table[key] ?? color;
}

/** Theme-aware colour for render-time use */
export function tc(light: string, role: ColorRole): string {
  return themeState.dark ? toDark(light, role) : light;
}

const STYLE_ROLES: Record<string, ColorRole> = {
  backgroundColor: "bg",
  color: "fg",
  tintColor: "fg",
  textDecorationColor: "fg",
  borderColor: "line",
  borderTopColor: "line",
  borderBottomColor: "line",
  borderLeftColor: "line",
  borderRightColor: "line",
};

function darkStyle(style: unknown): unknown {
  if (!style || typeof style !== "object" || Array.isArray(style)) return style;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
    const role = STYLE_ROLES[k];
    out[k] = role && typeof v === "string" ? toDark(v, role) : v;
  }
  return out;
}

let buildingLight = false;

/**
 * Lazily-built style sheet that resolves to the light or dark variant on
 * every property read. Pass a factory so palettes are read in light mode.
 */
export function themedStyles<T extends object>(factory: () => T): T {
  let light: T | undefined;
  let dark: T | undefined;
  const getLight = () => {
    if (!light) {
      buildingLight = true;
      try {
        light = factory();
      } finally {
        buildingLight = false;
      }
    }
    return light;
  };
  const getDark = () => {
    if (!dark) {
      const src = getLight() as Record<string, unknown>;
      const mapped: Record<string, unknown> = {};
      for (const k of Object.keys(src)) mapped[k] = darkStyle(src[k]);
      dark = StyleSheet.create(mapped as never) as T;
    }
    return dark;
  };
  return new Proxy({} as T, {
    get: (_t, prop) => (themeState.dark ? getDark() : getLight())[prop as keyof T],
    has: (_t, prop) => prop in getLight(),
    ownKeys: () => Reflect.ownKeys(getLight()),
    getOwnPropertyDescriptor: (_t, prop) => {
      const v = (themeState.dark ? getDark() : getLight())[prop as keyof T];
      return v === undefined ? undefined : { value: v, enumerable: true, configurable: true };
    },
  });
}

function paletteRole(key: string): ColorRole {
  if (/^on[A-Z]/.test(key)) return "fg";
  if (/border|divider|outline|line|stroke/i.test(key)) return "line";
  if (/bg|background|surface|card|sheet|header|soft|container|track|backdrop|highlight|fill|chip|pill|white/i.test(key)) {
    return "bg";
  }
  return "fg";
}

/** Colour constants object whose values follow the theme (role guessed from key) */
export function themedPalette<T extends Record<string, string>>(palette: T): T {
  return new Proxy(palette, {
    get: (target, prop) => {
      const v = target[prop as keyof T];
      if (typeof prop !== "string" || typeof v !== "string") return v;
      return themeState.dark && !buildingLight ? toDark(v, paletteRole(prop)) : v;
    },
  });
}

/** RN <StatusBar barStyle> for the current theme */
export function statusBarStyle(): "light-content" | "dark-content" {
  return themeState.dark ? "light-content" : "dark-content";
}
