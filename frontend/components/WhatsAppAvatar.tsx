import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useLiveSubscriptionBadge } from "../utils/subscriptions";
import { resolveMediaUrl } from "../utils/media";
import { Ionicons } from "@expo/vector-icons";

const IG_BLUE = "#0095F6";
/** Photo verification shield — green (separate from subscription blue tick) */
export const PHOTO_VERIFIED_GREEN = "#22C55E";

/** WhatsApp default DP — light gray circle + white person silhouette */
export const WA_DEFAULT_BG = "#DFE5E7";
export const WA_DEFAULT_ICON = "#FFFFFF";

function smoothSealPath(size: number, petals = 14) {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 0.3;
  const inner = outer * 0.8;
  let d = "";
  for (let i = 0; i < petals; i++) {
    const aValley = ((i - 0.5) * 2 * Math.PI) / petals - Math.PI / 2;
    const aTip = (i * 2 * Math.PI) / petals - Math.PI / 2;
    const aNext = ((i + 0.5) * 2 * Math.PI) / petals - Math.PI / 2;
    const vx = cx + inner * Math.cos(aValley);
    const vy = cy + inner * Math.sin(aValley);
    const tx = cx + outer * Math.cos(aTip);
    const ty = cy + outer * Math.sin(aTip);
    const nx = cx + inner * Math.cos(aNext);
    const ny = cy + inner * Math.sin(aNext);
    if (i === 0) d += `M ${vx.toFixed(3)} ${vy.toFixed(3)} `;
    d += `Q ${tx.toFixed(3)} ${ty.toFixed(3)} ${nx.toFixed(3)} ${ny.toFixed(3)} `;
  }
  return `${d}Z`;
}

export function VerifiedTick({
  avatarSize,
  inline = false,
}: {
  avatarSize: number;
  inline?: boolean;
}) {
  const dim = Math.max(18, Math.round(avatarSize * 0.34));
  const checkW = dim * 0.12;
  const check = `M ${dim * 0.28} ${dim * 0.52} L ${dim * 0.44} ${dim * 0.68} L ${dim * 0.74} ${dim * 0.34}`;

  return (
    <View
      pointerEvents="none"
      style={
        inline
          ? { width: dim, height: dim, marginLeft: 6 }
          : {
              position: "absolute",
              bottom: -1,
              right: -1,
              width: dim,
              height: dim,
              zIndex: 4,
            }
      }
    >
      <Svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
        <Path d={smoothSealPath(dim)} fill={IG_BLUE} />
        <Path
          d={check}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={checkW}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** Dating photo-verified shield (separate from subscription blue tick). */
export function PhotoVerifiedBadge({
  avatarSize,
  inline = false,
}: {
  avatarSize: number;
  inline?: boolean;
}) {
  const dim = Math.max(16, Math.round(avatarSize * 0.32));
  return (
    <View
      pointerEvents="none"
      style={
        inline
          ? { marginLeft: 4 }
          : {
              position: "absolute",
              bottom: -1,
              left: -1,
              zIndex: 4,
            }
      }
    >
      <Ionicons name="shield-checkmark" size={dim} color={PHOTO_VERIFIED_GREEN} />
    </View>
  );
}

/** True when the user has no usable profile photo (never set or removed). */
export function hasProfilePhoto(photo?: string | null): boolean {
  const raw = String(photo || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (
    lower === "null" ||
    lower === "undefined" ||
    lower === "none" ||
    lower === "default"
  ) {
    return false;
  }
  return true;
}

/**
 * WhatsApp-style default DP (no custom photo).
 * Gender assets are optional decorative fallbacks for toasts / marketing;
 * chat/profile avatars use the gray silhouette via WhatsAppAvatar.
 */
export function getGenderFallbackSource(gender?: string | null) {
  const g = String(gender || "")
    .trim()
    .toLowerCase();
  if (g === "female" || g === "woman" || g === "girl" || g === "f") {
    return require("../assets/images/girls-image.png");
  }
  if (g === "male" || g === "man" || g === "boy" || g === "m") {
    return require("../assets/images/boy-image.png");
  }
  return null;
}

/** WhatsApp-like avatar palette (used by getAvatarColor for non-avatar UI) */
const AVATAR_COLORS = [
  "#00A884",
  "#53BDEB",
  "#06CF9C",
  "#7F66FF",
  "#FF7A59",
  "#FFB900",
  "#E74C3C",
  "#3498DB",
  "#9B59B6",
  "#1ABC9C",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getAvatarColor(seed: string): string {
  if (!seed) return AVATAR_COLORS[0];
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length];
}

/** WhatsApp-style initials from a display name */
export function getInitials(
  name?: string | null,
  fallback?: string | null,
): string {
  const raw = (name || fallback || "").trim();
  if (!raw) return "?";

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  // Public ID like ABCD1234 → first 2 letters
  if (/^[A-Za-z]{4}\d{4}$/.test(raw)) {
    return raw.slice(0, 2).toUpperCase();
  }

  return raw.slice(0, 2).toUpperCase();
}

export function getDisplayName(
  name?: string | null,
  publicId?: string | null,
): string {
  const n = (name || "").trim();
  if (n && n.toLowerCase() !== "unknown" && n.toLowerCase() !== "anonymous") {
    return n;
  }
  if (publicId) return String(publicId).toUpperCase();
  return "Luvstor User";
}

/** Gray person silhouette — same look WhatsApp uses with no DP */
export function WhatsAppDefaultDp({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.initialsCircle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: WA_DEFAULT_BG,
        },
      ]}
    >
      <Ionicons
        name="person"
        size={Math.round(size * 0.55)}
        color={WA_DEFAULT_ICON}
      />
    </View>
  );
}

type Props = {
  photo?: string | null;
  name?: string | null;
  publicId?: string | null;
  gender?: string | null;
  size?: number;
  style?: ViewStyle;
  /** Show green online dot */
  online?: boolean;
  /** Instagram-style blue tick for subscribed users */
  badge?: string | null;
  /** ISO expiry — tick hides automatically when this time is reached */
  badgeExpiresAt?: string | Date | null;
  /**
   * WhatsApp privacy mode — when someone blocked you, show the universal
   * gray silhouette instead of their real DP.
   */
  privacyHidden?: boolean;
  /** Dating photo-verified shield */
  photoVerified?: boolean;
};

/**
 * WhatsApp-style avatar:
 * - Photo when set
 * - Gray default person DP when no photo / photo removed / load failed
 * - Same gray silhouette when privacyHidden (blocked-you case)
 */
export default function WhatsAppAvatar({
  photo,
  name,
  publicId,
  size = 50,
  style,
  online = false,
  badge = null,
  badgeExpiresAt = null,
  privacyHidden = false,
  photoVerified: _photoVerified = false,
}: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoKey = String(photo || "").trim();

  useEffect(() => {
    setPhotoFailed(false);
  }, [photoKey]);

  const liveBadge = useLiveSubscriptionBadge(badge, badgeExpiresAt);
  const hasPlanBadge = !privacyHidden && !!liveBadge;
  const showOnline = online && !privacyHidden && !hasPlanBadge;

  const hasPhoto =
    !privacyHidden && !photoFailed && hasProfilePhoto(photoKey);
  const photoUri = hasPhoto
    ? resolveMediaUrl(photoKey) || photoKey
    : "";

  return (
    <View style={[{ width: size, height: size, overflow: "visible" }, style]}>
      {privacyHidden || !hasPhoto ? (
        <WhatsAppDefaultDp size={size} />
      ) : (
        <Image
          source={{ uri: photoUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={`avatar-${photoUri}`}
          onError={() => setPhotoFailed(true)}
        />
      )}
      {showOnline ? (
        <View
          style={[
            styles.onlineDot,
            {
              width: Math.max(10, size * 0.22),
              height: Math.max(10, size * 0.22),
              borderRadius: Math.max(5, size * 0.11),
              borderWidth: Math.max(1.5, size * 0.04),
              ...(hasPlanBadge ? { right: undefined, left: 0 } : null),
            },
          ]}
        />
      ) : null}
      {/* Photo verification is shown next to the name — not on the DP */}
      {hasPlanBadge ? <VerifiedTick avatarSize={size} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  initialsCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#25D366",
    borderColor: "#FFF",
  },
});
