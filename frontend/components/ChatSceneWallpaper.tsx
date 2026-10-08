import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import type { ChatPaper, ChatScene } from "../utils/chatScenes";

type PaperProps = {
  paper: ChatPaper;
  width: number;
  height: number;
  dark: boolean;
  /** 1 = full size; thumbnails pass a smaller value */
  scale?: number;
};

/** Notebook / grid / dot / chevron paper drawn with SVG patterns */
function PaperWallpaperBase({ paper, width, height, dark, scale = 1 }: PaperProps) {
  const ink = dark ? paper.darkInk : paper.ink;
  const margin = dark ? paper.darkMargin : paper.margin;
  const gap = 28 * scale;
  const id = `paper-${paper.id}`;

  let tile: React.ReactNode;
  let tw = gap;
  let th = gap;
  if (paper.kind === "lines") {
    tw = width;
    tile = <Line x1={0} y1={gap - 0.5} x2={width} y2={gap - 0.5} stroke={ink} strokeWidth={1} />;
  } else if (paper.kind === "grid") {
    tw = th = 22 * scale;
    tile = (
      <Path d={`M ${tw} 0 L 0 0 0 ${th}`} fill="none" stroke={ink} strokeWidth={1} />
    );
  } else if (paper.kind === "dots") {
    tw = th = 22 * scale;
    tile = <Circle cx={tw / 2} cy={th / 2} r={1.4 * scale} fill={ink} />;
  } else {
    tw = 36 * scale;
    th = 30 * scale;
    tile = (
      <>
        <Path
          d={`M 0 ${th * 0.75} L ${tw / 2} ${th * 0.25} L ${tw} ${th * 0.75}`}
          fill="none"
          stroke={ink}
          strokeWidth={2.2 * scale}
        />
        <Line x1={0} y1={0} x2={0} y2={th} stroke={ink} strokeWidth={0.8 * scale} />
      </>
    );
  }

  return (
    <View
      pointerEvents="none"
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[StyleSheet.absoluteFill, { backgroundColor: dark ? paper.darkBg : paper.bg }]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <Pattern id={id} x={0} y={paper.kind === "lines" ? 40 * scale : 0} width={tw} height={th} patternUnits="userSpaceOnUse">
            {tile}
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        {margin ? (
          <Line
            x1={44 * scale}
            y1={0}
            x2={44 * scale}
            y2={height}
            stroke={margin}
            strokeWidth={1.4 * scale}
          />
        ) : null}
        {paper.holes
          ? Array.from({ length: Math.ceil(height / (120 * scale)) }, (_, i) => (
              <Circle
                key={i}
                cx={20 * scale}
                cy={(60 + i * 120) * scale}
                r={7 * scale}
                fill={dark ? "#0B0B0E" : "#E9E5DA"}
              />
            ))
          : null}
      </Svg>
    </View>
  );
}

export const PaperWallpaper = React.memo(PaperWallpaperBase);

/** Bundled illustrated wallpaper; light ones are dimmed in dark mode */
function SceneWallpaperBase({ scene, dark }: { scene: ChatScene; dark: boolean }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: scene.color }]}>
      <Image
        source={scene.source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={0}
      />
      {dark && !scene.dark ? <View style={[StyleSheet.absoluteFill, styles.dim]} /> : null}
    </View>
  );
}

export const SceneWallpaper = React.memo(SceneWallpaperBase);

const styles = StyleSheet.create({
  dim: { backgroundColor: "rgba(0,0,0,0.45)" },
});
