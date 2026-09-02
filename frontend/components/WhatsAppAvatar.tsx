import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useLiveSubscriptionBadge } from "../utils/subscriptions";

const IG_BLUE = "#0095F6";

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

/** WhatsApp-like avatar palette */
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
   * gray silhouette instead of their real DP / initials color.
   */
  privacyHidden?: boolean;
};

/**
 * WhatsApp-style avatar:
 * - Photo when set
 * - Colored circle + initials when profile photo is missing
 * - Gray silhouette when privacyHidden (blocked-you case)
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
}: Props) {
  const displayName = getDisplayName(name, publicId);
  const seed = publicId || name || displayName;
  const bg = getAvatarColor(seed);
  const initials = getInitials(name, publicId);
  const fontSize = Math.max(12, Math.round(size * 0.38));
  const hasPhoto = !privacyHidden && !!(photo && String(photo).trim());
  const liveBadge = useLiveSubscriptionBadge(badge, badgeExpiresAt);
  const hasPlanBadge = !privacyHidden && !!liveBadge;
  // Subscribed users use "Online now" text instead of the green DP dot.
  const showOnline = online && !privacyHidden && !hasPlanBadge;

  return (
    <View style={[{ width: size, height: size, overflow: "visible" }, style]}>
      {privacyHidden ? (
        <View
          style={[
            styles.initialsCircle,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: "#DFE5E7",
            },
          ]}
        >
          <Ionicons
            name="person"
            size={Math.round(size * 0.55)}
            color="#FFFFFF"
          />
        </View>
      ) : hasPhoto ? (
        <Image
          source={{ uri: String(photo) }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={0}
          recyclingKey={String(photo)}
        />
      ) : (
        <View
          style={[
            styles.initialsCircle,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: bg,
            },
          ]}
        >
          <Text
            style={[
              styles.initialsText,
              { fontSize, lineHeight: fontSize + 2 },
            ]}
          >
            {initials}
          </Text>
        </View>
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
      {hasPlanBadge ? <VerifiedTick avatarSize={size} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  initialsCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    color: "#FFF",
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: "#25D366",
    borderColor: "#FFF",
  },
});
