import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";
import { type ChatGradient, findPattern, gradientColors, type Sticker } from "../utils/chatPatterns";
import ChatWallpaperPattern, { hash, PatternGlyph } from "./ChatWallpaperPattern";

type Props = {
  gradient: ChatGradient;
  width: number;
  height: number;
  dark: boolean;
  cell?: number;
};

/** Large full-colour stickers with a drop shadow, scattered on a staggered grid */
function StickerLayer({
  stickers,
  width,
  height,
  cell,
  dark,
}: {
  stickers: Sticker[];
  width: number;
  height: number;
  cell: number;
  dark: boolean;
}) {
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? cell / 2 : 0;
    for (let c = 0; c < cols; c++) {
      const seed = r * 131 + c * 17 + 3;
      if (hash(seed) < 0.18) continue;
      const st = stickers[(r * 2 + c * 3 + Math.floor(hash(seed + 1) * 2)) % stickers.length];
      const size = cell * (0.4 + hash(seed + 2) * 0.2);
      nodes.push(
        <PatternGlyph
          key={`${r}-${c}`}
          name={st.icon}
          size={size}
          color={st.color}
          style={[
            styles.sticker,
            dark && styles.stickerDim,
            {
              left: c * cell - shift + (hash(seed + 3) - 0.5) * cell * 0.3,
              top: r * cell + (hash(seed + 4) - 0.5) * cell * 0.3,
              transform: [{ rotate: `${Math.round((hash(seed + 5) - 0.5) * 50)}deg` }],
            },
          ]}
        />,
      );
    }
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      {nodes}
    </View>
  );
}

/** Gradient wallpaper; "Art" adds soft white doodles, "Themes" add colour stickers */
function ChatGradientWallpaper({ gradient, width, height, dark, cell }: Props) {
  const pattern = gradient.pattern ? findPattern(gradient.pattern) : undefined;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradientColors(gradient, dark)}
        start={gradient.start ?? { x: 0, y: 0 }}
        end={gradient.end ?? { x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {pattern ? (
        <ChatWallpaperPattern
          pattern={pattern}
          width={width}
          height={height}
          dark={dark}
          cell={cell}
          overlayInk={dark && !gradient.dark ? "rgba(255,255,255,0.10)" : gradient.ink}
        />
      ) : null}
      {gradient.stickers ? (
        <StickerLayer
          stickers={gradient.stickers}
          width={width}
          height={height}
          cell={(cell ?? 62) * 1.7}
          dark={dark && !gradient.dark}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  sticker: {
    position: "absolute",
    opacity: 0.9,
    textShadowColor: "rgba(0,0,0,0.28)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 5,
  },
  stickerDim: { opacity: 0.55 },
});

export default React.memo(ChatGradientWallpaper);
