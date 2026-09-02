import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WhatsAppAvatar, { getDisplayName, VerifiedTick } from "./WhatsAppAvatar";
import { isValidPublicId } from "../utils/auth";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = Math.round(SCREEN_HEIGHT * 0.92);
const SHEET_RADIUS = 18;

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

export type ProfileInfoData = {
  name?: string;
  publicId?: string;
  age?: number;
  photo?: string;
  gender?: string;
  height?: number | null;
  relationshipGoal?: string;
  showMeLabel?: string;
  distanceLabel?: string;
  interests?: string[];
  subscriptionBadge?: string | null;
  subscriptionExpiresAt?: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  info: ProfileInfoData;
  onEditPress?: () => void;
};

function InfoRow({
  icon,
  iconColor,
  title,
  value,
  emptyLabel = "Not set",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  title: string;
  value?: string;
  emptyLabel?: string;
}) {
  const display = value?.trim() || emptyLabel;
  const isEmpty = !value?.trim() || value === "Not specified";
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: iconColor }]}>
        <Ionicons name={icon} size={20} color="#fff" />
      </View>
      <View style={styles.infoContent}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={[styles.infoValue, isEmpty && styles.infoValueEmpty]}>
          {display}
        </Text>
      </View>
    </View>
  );
}

export default function ProfileInfoModal({
  visible,
  onClose,
  info,
  onEditPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const displayName = getDisplayName(info.name, info.publicId);
  const hasVerified = !!info.subscriptionBadge;
  const interests = info.interests?.filter(Boolean) ?? [];

  const rows = [
    {
      icon: "person" as const,
      color: "#9C27B0",
      title: "Gender",
      value: info.gender,
    },
    {
      icon: "resize" as const,
      color: "#FF9800",
      title: "Height",
      value: info.height ? `${info.height} cm` : undefined,
    },
    {
      icon: "heart" as const,
      color: "#FF4B6E",
      title: "Looking for",
      value: info.relationshipGoal
        ? `${GOAL_EMOJIS[info.relationshipGoal] || ""} ${info.relationshipGoal}`.trim()
        : undefined,
    },
    {
      icon: "people" as const,
      color: "#2196F3",
      title: "Show me",
      value: info.showMeLabel,
    },
    {
      icon: "locate" as const,
      color: "#6750A4",
      title: "Discovery distance",
      value: info.distanceLabel,
    },
  ];

  const visibleRows = onEditPress
    ? rows
    : rows.filter((row) => row.value?.trim());

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.sheetHandleWrap}>
            <View style={styles.sheetHandle} />
          </View>

          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onClose}
              hitSlop={12}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color="#262626" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile info</Text>
            <View style={styles.backBtn} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            <View style={styles.hero}>
              <WhatsAppAvatar
                photo={info.photo}
                name={info.name}
                publicId={info.publicId}
                size={88}
                badge={info.subscriptionBadge}
                badgeExpiresAt={info.subscriptionExpiresAt}
              />
              <View style={styles.nameRow}>
                <Text style={styles.heroName}>
                  {displayName}
                  {info.age ? `, ${info.age}` : ""}
                </Text>
                {hasVerified ? <VerifiedTick avatarSize={52} inline /> : null}
              </View>
              {isValidPublicId(info.publicId) ? (
                <Text style={styles.heroId}>
                  ID: {String(info.publicId).toUpperCase()}
                </Text>
              ) : null}
              <Text style={styles.heroHint}>
                Profile details help others learn more about you on Luvstor.
              </Text>
            </View>

            {visibleRows.length > 0 ? (
              <View style={styles.section}>
                {visibleRows.map((row, index) => (
                  <React.Fragment key={row.title}>
                    <InfoRow
                      icon={row.icon}
                      iconColor={row.color}
                      title={row.title}
                      value={row.value}
                    />
                    {index < visibleRows.length - 1 ? (
                      <View style={styles.divider} />
                    ) : null}
                  </React.Fragment>
                ))}
              </View>
            ) : null}

            {interests.length > 0 ? (
              <View style={styles.interestsSection}>
                <View style={styles.interestsHeader}>
                  <View
                    style={[styles.infoIcon, { backgroundColor: "#4CAF50" }]}
                  >
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  </View>
                  <Text style={styles.interestsTitle}>Interests</Text>
                </View>
                <View style={styles.interestsWrap}>
                  {interests.map((interest) => (
                    <View key={interest} style={styles.interestChip}>
                      <Text style={styles.interestText}>
                        {INTEREST_EMOJIS[interest] || "✨"} {interest}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : onEditPress ? (
              <View style={styles.interestsSection}>
                <View style={styles.interestsHeader}>
                  <View
                    style={[styles.infoIcon, { backgroundColor: "#4CAF50" }]}
                  >
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  </View>
                  <Text style={styles.interestsTitle}>Interests</Text>
                </View>
                <Text style={styles.infoValueEmpty}>Not set</Text>
              </View>
            ) : null}
          </ScrollView>

          {onEditPress ? (
            <View
              style={[
                styles.footer,
                { paddingBottom: Math.max(insets.bottom, 16) },
              ]}
            >
              <TouchableOpacity
                style={styles.editBtn}
                activeOpacity={0.85}
                onPress={() => {
                  onClose();
                  onEditPress();
                }}
              >
                <Text style={styles.editBtnText}>Edit profile info</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ height: Math.max(insets.bottom, 12) }} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    height: SHEET_HEIGHT,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    overflow: "hidden",
  },
  sheetHandleWrap: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 2,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DBDBDB",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DBDBDB",
  },
  backBtn: {
    width: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#262626",
  },
  scrollContent: {
    paddingBottom: 24,
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
  },
  heroName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#262626",
  },
  heroId: {
    marginTop: 4,
    fontSize: 13,
    color: "#8E8E8E",
    fontWeight: "500",
  },
  heroHint: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 18,
    color: "#8E8E8E",
    textAlign: "center",
  },
  section: {
    marginHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#FAFAFA",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#EFEFEF",
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 12,
    color: "#8E8E8E",
    fontWeight: "500",
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    color: "#262626",
    fontWeight: "500",
  },
  infoValueEmpty: {
    color: "#8E8E8E",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E7E0EC",
    marginLeft: 62,
  },
  interestsSection: {
    marginTop: 20,
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FAFAFA",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#EFEFEF",
  },
  interestsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  interestsTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#262626",
  },
  interestsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  interestChip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DBDBDB",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  interestText: {
    fontSize: 13,
    color: "#262626",
    fontWeight: "500",
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DBDBDB",
  },
  editBtn: {
    backgroundColor: "#6750A4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  editBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
