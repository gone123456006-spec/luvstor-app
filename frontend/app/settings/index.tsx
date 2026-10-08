import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
    Alert,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { sharePublicProfile } from "../../components/CopyablePublicId";
import { getDisplayName } from "../../components/WhatsAppAvatar";
import { getCachedProfile, preloadProfile } from "../../utils/profileCache";
import { NAV_ICON, SHOW_ROW_CHEVRON } from "../../utils/platformIcons";
import ListRowTouchable from "../../components/ListRowTouchable";
import { statusBarStyle, tc, themedPalette, themedStyles } from "../../utils/theme";

const WA = themedPalette({
  bg: "#F5F5F7",
  white: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  border: "#E8E8ED",
  primary: "#370372",
  header: "#F5F5F7",
  iconSoft: "#EFE8F8",
});

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  sub: string;
  onPress: () => void;
  showDivider?: boolean;
};

function SettingsRow({
  icon,
  color,
  label,
  sub,
  onPress,
  showDivider,
}: RowProps) {
  return (
    <>
      <ListRowTouchable
        style={styles.listRow}
        activeOpacity={0.7}
        onPress={onPress}
      >
        <View style={[styles.iconCircle, { backgroundColor: color }]}>
          <Ionicons name={icon} size={20} color="#fff" />
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowSub}>{sub}</Text>
        </View>
        {SHOW_ROW_CHEVRON ? (
          <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
        ) : null}
      </ListRowTouchable>
      {showDivider ? <View style={styles.divider} /> : null}
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const [publicId, setPublicId] = useState("");
  const [name, setName] = useState("");

  useFocusEffect(
    useCallback(() => {
      const cached = getCachedProfile();
      if (cached?.profile) {
        setPublicId(String(cached.profile.publicId || ""));
        setName(String(cached.profile.name || ""));
      }
      void preloadProfile({ force: false }).then((snap) => {
        if (snap?.profile) {
          setPublicId(String(snap.profile.publicId || ""));
          setName(String(snap.profile.name || ""));
        }
      });
    }, []),
  );

  const onShareProfile = () => {
    void sharePublicProfile({
      publicId,
      name: getDisplayName(name, publicId),
    }).then((ok) => {
      if (!ok) {
        Alert.alert(
          "Could not share",
          "Your profile ID is not ready yet. Try again in a moment.",
        );
      }
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle={statusBarStyle()} backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.listGroup}>
          <SettingsRow
            icon="person"
            color={WA.primary}
            label="Account"
            sub="Login details, logout, delete account"
            onPress={() => router.push("/settings/account" as any)}
          />
        </View>

        <View style={[styles.listGroup, styles.listGroupSpaced]}>
          <SettingsRow
            icon="key"
            color={tc("#6750A4", "fg")}
            label="Permissions"
            sub="Microphone, camera, photos, music & calls"
            onPress={() => router.push("/settings/permissions" as any)}
            showDivider
          />
          <SettingsRow
            icon="notifications"
            color="#25D366"
            label="Notifications"
            sub="Messages, matches, calls and more"
            onPress={() => router.push("/settings/notifications" as any)}
            showDivider
          />
          <SettingsRow
            icon="accessibility"
            color="#0A84FF"
            label="Accessibility"
            sub="Text size, bold text, reduce motion, haptics"
            onPress={() => router.push("/settings/accessibility" as any)}
            showDivider
          />
          <SettingsRow
            icon="moon"
            color="#5856D6"
            label="Theme"
            sub="Light, dark or follow your phone"
            onPress={() => router.push("/settings/theme" as any)}
            showDivider
          />
          <SettingsRow
            icon="image"
            color="#FF2D55"
            label="Chat wallpaper"
            sub="Colour or photo behind your chats"
            onPress={() => router.push("/settings/chat-wallpaper" as any)}
            showDivider
          />
          <SettingsRow
            icon="call"
            color="#128C7E"
            label="Calls"
            sub="Voice and video call history"
            onPress={() => router.push("/calls" as any)}
          />
        </View>

        <View style={[styles.listGroup, styles.listGroupSpaced]}>
          <SettingsRow
            icon={NAV_ICON.share}
            color={WA.primary}
            label="Share profile"
            sub={
              publicId ? `ID ${publicId}` : "Share your Luvstor profile link"
            }
            onPress={onShareProfile}
            showDivider
          />
          <SettingsRow
            icon="ban"
            color="#EA4335"
            label="Blocked"
            sub="People you've blocked"
            onPress={() => router.push("/blocked" as any)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: WA.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: WA.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: WA.iconSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: { fontSize: 20, fontWeight: "600", color: WA.text },
  scroll: { paddingBottom: 40, paddingTop: 12, backgroundColor: WA.bg },
  listGroup: {
    backgroundColor: WA.bg,
    marginHorizontal: 0,
  },
  listGroupSpaced: { marginTop: 6 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 16,
    backgroundColor: WA.bg,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 17, color: WA.text, fontWeight: "400" },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
}),
);
