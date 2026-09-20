import { Image, type ImageContentFit, type ImageProps } from "expo-image";
import React, { useEffect, useMemo, useState } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import {
  mediaIdentity,
  mediaUrlCandidates,
  resolveMediaUrl,
} from "../utils/media";

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
  /** Called when every candidate URL fails to load */
  onExhausted?: () => void;
  /** Soft gray fill when URI missing or all hosts fail (avoids blank holes) */
  showPlaceholder?: boolean;
};

/**
 * Warm disk cache so DP / cover / posts stay visible offline once seen.
 */
export function prefetchMedia(uri?: string | null): void {
  for (const candidate of mediaUrlCandidates(uri)) {
    Image.prefetch(candidate, "memory-disk").catch(() => {});
  }
}

/**
 * Loads profile / post / cover media with quiet host failover.
 * Tries production + API bases for `/uploads/...` without blanking the
 * previous frame between hops (recyclingKey stays on media identity).
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
  showPlaceholder = true,
}: Props) {
  const candidates = useMemo(() => mediaUrlCandidates(uri), [uri]);
  const identity = useMemo(
    () => mediaIdentity(uri) || candidates[0] || "",
    [uri, candidates],
  );
  const [index, setIndex] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    setIndex(0);
    setExhausted(false);
  }, [identity]);

  const resolved = !exhausted
    ? candidates[index] || resolveMediaUrl(uri) || ""
    : "";

  if (!resolved) {
    if (!showPlaceholder) return null;
    return <View style={[{ backgroundColor: "#E8E8E8" }, style as any]} />;
  }

  return (
    <Image
      source={{ uri: resolved }}
      style={style as any}
      contentFit={contentFit}
      cachePolicy={cachePolicy}
      transition={transition}
      {...(recyclingKey
        ? { recyclingKey: `${recyclingKey}:${identity}:c${index}` }
        : null)}
      onLoad={onLoad}
      onError={(e) => {
        onError?.(e);
        const next = index + 1;
        if (next < candidates.length) {
          setIndex(next);
          return;
        }
        setExhausted(true);
        onExhausted?.();
      }}
    />
  );
}
