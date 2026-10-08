import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";
import type { ChatPattern, PatternIcon } from "../utils/chatPatterns";

function PatternGlyph({ name, ...rest }: { name: PatternIcon; size: number; color: string; style: object }) {
  if (name.startsWith("mci:")) {
    return (
      <MaterialCommunityIcons
        name={name.slice(4) as keyof typeof MaterialCommunityIcons.glyphMap}
        {...rest}
      />
    );
  }
  return <Ionicons name={name as keyof typeof Ionicons.glyphMap} {...rest} />;
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type Props = {
  pattern: ChatPattern;
  width: number;
  height: number;
  dark: boolean;
  /** Grid spacing; icons scale with it */
  cell?: number;
};

/**
 * Static doodle wallpaper: a staggered grid of tilted icons in two inks, with
 * tiny filler marks in the gaps. Seeded, so it looks the same on every render.
 */
function ChatWallpaperPattern({ pattern, width, height, dark, cell = 62 }: Props) {
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const ink = dark ? pattern.darkInk : pattern.ink;
  const ink2 = dark ? pattern.darkInk2 : pattern.ink2;
  const nodes: React.ReactNode[] = [];

  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? cell / 2 : 0;
    for (let c = 0; c < cols; c++) {
      const seed = r * 97 + c * 31 + 7;
      // Neighbours never repeat the same icon
      const name = pattern.icons[(r * 3 + c * 2 + Math.floor(hash(seed) * 2)) % pattern.icons.length];
      const size = cell * (0.36 + hash(seed + 1) * 0.16);
      const x = c * cell - shift + (hash(seed + 2) - 0.5) * cell * 0.22;
      const y = r * cell + (hash(seed + 3) - 0.5) * cell * 0.22;
      const rot = Math.round((hash(seed + 4) - 0.5) * 44);
      nodes.push(
        <PatternGlyph
          key={`i${r}-${c}`}
          name={name}
          size={size}
          color={(r + c) % 3 === 0 ? ink2 : ink}
          style={[styles.abs, { left: x, top: y, transform: [{ rotate: `${rot}deg` }] }]}
        />,
      );

      if (hash(seed + 5) < 0.55) {
        const filler = pattern.fillers[Math.floor(hash(seed + 6) * pattern.fillers.length)];
        const fs = cell * (filler === "ellipse" ? 0.08 : 0.16);
        nodes.push(
          <PatternGlyph
            key={`f${r}-${c}`}
            name={filler}
            size={fs}
            color={ink2}
            style={[
              styles.abs,
              { left: x + cell * 0.62, top: y + cell * (0.55 + hash(seed + 7) * 0.2) },
            ]}
          />,
        );
      }
    }
  }

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.clip,
        { backgroundColor: dark ? pattern.darkBg : pattern.bg },
      ]}
    >
      {nodes}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  abs: { position: "absolute" },
});

export default React.memo(ChatWallpaperPattern);
