import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { MAX_PROFILE_GALLERY } from "../constants/profile";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GRID_COLS = 3;
const GRID_GAP = 2;
const GRID_CELL = Math.floor(
  (SCREEN_WIDTH - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
);

const IG = {
  bg: "#FFFFFF",
  text: "#262626",
  secondary: "#8E8E8E",
  border: "#DBDBDB",
  chipBg: "#FAFAFA",
};

const INTEREST_EMOJIS: Record<string, string> = {
  Travel: "✈️",
  Music: "🎵",
  Fitness: "🏋️",
  Cooking: "🍳",
  Art: "🎨",
  Gaming: "🎮",
  Movies: "🎬",
  Photography: "📷",
  Reading: "📖",
  Dancing: "💃",
  Nature: "🍃",
  Coffee: "☕",
  Yoga: "🧘",
  Sports: "⚽",
  Pets: "🐾",
  Food: "🍕",
};

const GOAL_EMOJIS: Record<string, string> = {
  "Long-term relationship": "👩‍❤️‍👨",
  "Casual dating": "🥂",
  Friendship: "🤝",
  "Just vibes": "🤙",
  "See where it goes": "🧭",
  "Meaningful connection": "💖",
  "Chat & chill": "💬",
  "Friends first": "👫",
  Exploring: "🎒",
  "Open to possibilities": "🌟",
};

export type ProfileInstagramSectionProps = {
  bio?: string;
  bioFallback?: string;
  relationshipGoal?: string;
  interests?: string[];
  gallery: string[];
  maxSlots?: number;
  onPhotoPress: (index: number) => void;
  onPhotoLongPress?: (index: number) => void;
  /** Own profile: manage empty slots with add / locked states */
  manageGallery?: boolean;
  gallerySlotBusy?: number | null;
  onEditPress?: () => void;
  editHint?: string;
  /** Opens dedicated profile info page */
  onInfoPress?: () => void;
};

export default function ProfileInstagramSection({
  bio,
  bioFallback = "Hey there! I am using Luvstor",
  relationshipGoal,
  interests = [],
  gallery,
  maxSlots = MAX_PROFILE_GALLERY,
  onPhotoPress,
  onPhotoLongPress,
  manageGallery = false,
  gallerySlotBusy = null,
  onEditPress,
  editHint,
  onInfoPress,
}: ProfileInstagramSectionProps) {
  const bioText = bio?.trim() || bioFallback;
  const slots = Array.from({ length: maxSlots }, (_, i) => gallery[i] || "");
  const filledCount = gallery.filter(Boolean).length;
  const visibleInterests = interests.slice(0, 3);
  const lookingForLabel = relationshipGoal?.trim()
    ? `${GOAL_EMOJIS[relationshipGoal] || ""} ${relationshipGoal}`.trim()
    : "";

  return (
    <View style={styles.root}>
      {lookingForLabel ? (
        <View style={styles.lookingForBlock}>
          <View style={styles.lookingForChip}>
            <Text style={styles.lookingForValue}>{lookingForLabel}</Text>
          </View>
        </View>
      ) : null}

      {/* About — bio only */}
      <TouchableOpacity
        style={styles.bioBlock}
        activeOpacity={onEditPress ? 0.7 : 1}
        onPress={onEditPress}
        disabled={!onEditPress}
      >
        <Text style={styles.bioText}>{bioText}</Text>
        {editHint ? <Text style={styles.editHint}>{editHint}</Text> : null}
      </TouchableOpacity>

      {visibleInterests.length > 0 || onInfoPress ? (
        <View style={styles.interestsRow}>
          <View style={styles.interestsChips}>
            {visibleInterests.map((interest) => (
              <View key={interest} style={styles.interestChip}>
                <Text
                  style={styles.interestText}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {INTEREST_EMOJIS[interest] || "✨"} {interest}
                </Text>
              </View>
            ))}
          </View>
          {onInfoPress ? (
            <TouchableOpacity
              style={styles.infoBtn}
              activeOpacity={0.7}
              onPress={onInfoPress}
              hitSlop={8}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color="#6750A4"
              />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* IG-style tab bar */}
      <View style={styles.tabBar}>
        <View style={styles.tabActive}>
          <Ionicons name="grid" size={22} color={IG.text} />
        </View>
        <Text style={styles.postCount}>
          {filledCount} {filledCount === 1 ? "post" : "posts"}
        </Text>
      </View>

      {/* 3-column photo grid */}
      <View style={styles.grid}>
        {manageGallery
          ? slots.map((uri, index) => {
              const busy = gallerySlotBusy === index;
              const canAdd =
                !uri && index === gallery.filter(Boolean).length;
              const locked =
                !uri && index > gallery.filter(Boolean).length;

              if (locked) {
                return (
                  <View key={`ig-slot-${index}`} style={styles.gridCell}>
                    <View style={[styles.gridEmpty, styles.gridEmptyLocked]}>
                      <Ionicons name="lock-closed" size={20} color="#C7C7CC" />
                    </View>
                  </View>
                );
              }

              if (!uri && canAdd) {
                return (
                  <TouchableOpacity
                    key={`ig-slot-${index}`}
                    style={styles.gridCell}
                    activeOpacity={0.85}
                    onPress={() => onPhotoPress(index)}
                  >
                    <View style={styles.gridEmpty}>
                      <Ionicons name="add" size={28} color="#262626" />
                    </View>
                  </TouchableOpacity>
                );
              }

              if (!uri) return null;

              return (
                <TouchableOpacity
                  key={`ig-slot-${index}`}
                  style={styles.gridCell}
                  activeOpacity={0.85}
                  disabled={busy}
                  onPress={() => onPhotoPress(index)}
                  onLongPress={
                    onPhotoLongPress ? () => onPhotoLongPress(index) : undefined
                  }
                  delayLongPress={350}
                >
                  <Image
                    source={{ uri }}
                    style={styles.gridImage}
                    contentFit="cover"
                    cachePolicy="none"
                  />
                  {busy ? (
                    <View style={styles.gridBusy}>
                      <ActivityIndicator color="#fff" size="small" />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })
          : gallery.map((uri, index) =>
              uri ? (
                <TouchableOpacity
                  key={`ig-photo-${index}`}
                  style={styles.gridCell}
                  activeOpacity={0.85}
                  onPress={() => onPhotoPress(index)}
                >
                  <Image
                    source={{ uri }}
                    style={styles.gridImage}
                    contentFit="cover"
                  />
                </TouchableOpacity>
              ) : null,
            )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: IG.bg,
  },
  lookingForBlock: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  lookingForChip: {
    alignSelf: "flex-start",
    backgroundColor: "#262626",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lookingForValue: {
    fontSize: 10,
    fontWeight: "500",
    color: "#FFFFFF",
    lineHeight: 13,
  },
  bioBlock: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  bioText: {
    fontSize: 14,
    lineHeight: 20,
    color: IG.text,
    fontWeight: "400",
  },
  editHint: {
    marginTop: 6,
    fontSize: 12,
    color: IG.secondary,
  },
  interestsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  interestsChips: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    minWidth: 0,
  },
  interestChip: {
    flex: 1,
    minWidth: 0,
    backgroundColor: IG.chipBg,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: IG.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  interestText: {
    fontSize: 11,
    lineHeight: 14,
    color: IG.text,
    fontWeight: "500",
    textAlign: "center",
    width: "100%",
  },
  infoBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3EEFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#EADDFF",
    flexShrink: 0,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: IG.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IG.border,
    paddingVertical: 10,
    gap: 12,
  },
  tabActive: {
    borderBottomWidth: 1,
    borderBottomColor: IG.text,
    paddingBottom: 8,
    marginBottom: -10,
  },
  postCount: {
    position: "absolute",
    right: 16,
    fontSize: 12,
    color: IG.secondary,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  gridCell: {
    width: GRID_CELL,
    height: GRID_CELL,
    backgroundColor: "#EFEFEF",
    overflow: "hidden",
  },
  gridImage: {
    width: "100%",
    height: "100%",
  },
  gridEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAFA",
  },
  gridEmptyLocked: {
    backgroundColor: "#F5F5F5",
  },
  gridBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
});
