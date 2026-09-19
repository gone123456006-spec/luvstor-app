import { Image, type ImageContentFit, type ImageProps } from "expo-image";
import React, { useMemo } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { mediaIdentity, resolveMediaUrl } from "../utils/media";

type Props = {
  uri?: string | null;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Unique list-slot label only (e.g. "ig-photo-2"). Omit for avatars. */
  recyclingKey?: string;
  transition?: number;
  cachePolicy?: ImageProps["cachePolicy"];
  onLoad?: ImageProps["onLoad"];
  onError?: ImageProps["onError"];
  /** Called when the resolved URL fails to load */
  onExhausted?: () => void;
};

/**
 * Warm disk cache so DP / cover / posts stay visible offline once seen.
 */
export function prefetchMedia(uri?: string | null): void {
  const resolved = resolveMediaUrl(uri);
  if (!resolved) return;
  Image.prefetch(resolved, "memory-disk").catch(() => {});
}

/**
 * Single-URL media image — no candidate hopping / remounts.
 * Multi-URL failover was causing blink-blink-blink as each failed URL
 * triggered a setState and a blank frame.
 */
export default function MediaImage({
  uri,
  style,
  contentFit = "cover",
  recyclingKey,
  transition = 0,
  cachePolicy = "memory-disk",
  onLoad,
  onError,
  onExhausted,
}: Props) {
  const resolved = useMemo(() => resolveMediaUrl(uri) || "", [uri]);
  const identity = useMemo(() => mediaIdentity(uri) || resolved, [uri, resolved]);

  if (!resolved) return null;

  return (
    <Image
      source={{ uri: resolved }}
      style={style as any}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      {...(recyclingKey
        ? { recyclingKey: `${recyclingKey}:${identity}` }
        : null)}
      onLoad={onLoad}
      onError={(e) => {
        onError?.(e);
        onExhausted?.();
      }}
    />
  );
}
