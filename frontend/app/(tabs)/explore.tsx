import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect } from "react";
import {
    ActivityIndicator,
    Dimensions,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppAlert } from "../../components/AppAlert";
import WhatsAppAvatar, {
    getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useCall } from "../../contexts/CallContext";
import { useExplore } from "../../contexts/ExploreContext";
import { useSocket } from "../../contexts/SocketContext";
import { isWebRTCAvailable } from "../../services/webrtc";
import { resolveMediaUrl } from "../../utils/media";

const { width: SCREEN_W } = Dimensions.get("window");
const TILE_GAP = 12;
const TILE_W = (SCREEN_W - 32 - TILE_GAP) / 2;

/** App page background only — rest of UI unchanged */
const APP_BG = "#FDF8FF";

const IG = {
  bg: "#FAFAFA",
  surface: "#FFFFFF",
  text: "#262626",
  secondary: "#8E8E8E",
  border: "#EFEFEF",
  black: "#000000",
  link: "#0095F6",
  muted: "#F5F5F5",
};

export default function ExploreScreen() {
  const { socket } = useSocket();
  const call = useCall();
  const { showAlert } = useAppAlert();
  const {
    mode,
    setMode,
    status,
    cooldownSec,
    matchedPeer,
    joinQueue,
    skipWithCooldown,
    leaveQueue,
  } = useExplore();

  const inExploreCall =
    call.isExplore && call.phase !== "idle" && call.phase !== "ended";

  const handleJoin = useCallback(() => {
    if (!socket?.connected) {
      showAlert({
        title: "Offline",
        message: "Connect to the internet and try again.",
      });
      return;
    }
    if (!isWebRTCAvailable()) {
      showAlert({
        title: "Development build required",
        message:
          "Explore calls need a development build (WebRTC is not in Expo Go).",
      });
      return;
    }
    if (call.phase !== "idle" && call.phase !== "ended") {
      showAlert({ title: "Busy", message: "Finish your current call first." });
      return;
    }
    joinQueue();
  }, [call.phase, joinQueue, showAlert, socket?.connected]);

  useFocusEffect(
    useCallback(() => {
      return () => leaveQueue();
    }, [leaveQueue]),
  );

  useEffect(() => {
    if (!socket) return;
    const onError = (payload: { error?: string }) => {
      showAlert({
        title: "Explore",
        message: payload?.error || "Could not join Explore",
      });
    };
    socket.on("explore:error", onError);
    return () => {
      socket.off("explore:error", onError);
    };
  }, [showAlert, socket]);

  if (inExploreCall) {
    const peerPhoto =
      resolveMediaUrl(matchedPeer?.photo || call.peer?.photo) || "";
    const peerName = getDisplayName(
      matchedPeer?.name || call.peer?.name,
      matchedPeer?.publicId || call.peer?.publicId,
    );
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <Header />
        <View style={styles.callScreen}>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
          <View style={styles.avatarRingLg}>
            <WhatsAppAvatar
              name={matchedPeer?.name || call.peer?.name}
              publicId={matchedPeer?.publicId || call.peer?.publicId}
              photo={peerPhoto}
              gender={matchedPeer?.gender || call.peer?.gender}
              size={96}
            />
          </View>
          <Text style={styles.callName}>{peerName}</Text>
          {matchedPeer?.publicId || call.peer?.publicId ? (
            <Text style={styles.callHandle}>
              @{matchedPeer?.publicId || call.peer?.publicId}
            </Text>
          ) : null}
          <Text style={styles.callHint}>Call in progress</Text>
        </View>
      </SafeAreaView>
    );
  }

  const busy = status === "searching" || status === "cooldown";
  const canJoin = status === "idle";
  const showSkip = status === "searching";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <Header />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {status === "idle" ? (
          <View style={styles.hero}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="shuffle" size={32} color={IG.text} />
            </View>
            <Text style={styles.heroTitle}>Meet someone new</Text>
            <Text style={styles.heroSub}>
              Pick video or voice, then tap Join
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Mode</Text>
        <View style={styles.tileRow}>
          <ModeTile
            icon="videocam"
            label="Video"
            sub="Camera + mic"
            active={mode === "video"}
            disabled={busy}
            onPress={() => setMode("video")}
          />
          <ModeTile
            icon="call"
            label="Voice"
            sub="Mic only"
            active={mode === "voice"}
            disabled={busy}
            onPress={() => setMode("voice")}
          />
        </View>

        {status !== "idle" ? (
          <View style={styles.statusCard}>
            {status === "cooldown" ? (
              <>
                <View style={styles.countdownRing}>
                  <Text style={styles.countdownNum}>{cooldownSec}</Text>
                </View>
                <Text style={styles.statusTitle}>Finding next person</Text>
                <Text style={styles.statusSub}>{cooldownSec}s remaining</Text>
              </>
            ) : status === "matched" && matchedPeer ? (
              <>
                <View style={styles.avatarRingMd}>
                  <WhatsAppAvatar
                    name={matchedPeer.name}
                    publicId={matchedPeer.publicId}
                    photo={
                      resolveMediaUrl(matchedPeer.photo) ||
                      matchedPeer.photo ||
                      ""
                    }
                    gender={matchedPeer.gender}
                    size={72}
                  />
                </View>
                <Text style={styles.statusTitle}>
                  {getDisplayName(matchedPeer.name, matchedPeer.publicId)}
                </Text>
                {matchedPeer.publicId ? (
                  <Text style={styles.statusHandle}>
                    @{matchedPeer.publicId}
                  </Text>
                ) : null}
                <View style={styles.connectingPill}>
                  <ActivityIndicator size="small" color={IG.text} />
                  <Text style={styles.connectingText}>Connecting</Text>
                </View>
              </>
            ) : status === "searching" ? (
              <>
                <View style={styles.searchPulse}>
                  <ActivityIndicator size="large" color={IG.text} />
                </View>
                <Text style={styles.statusTitle}>Searching</Text>
                <Text style={styles.statusSub}>
                  Looking for a {mode === "video" ? "video" : "voice"} match…
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {canJoin ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleJoin}
            style={styles.joinBtn}
          >
            <Ionicons
              name="radio"
              size={18}
              color="#fff"
              style={styles.joinIcon}
            />
            <Text style={styles.joinText}>Join</Text>
          </TouchableOpacity>
        ) : showSkip ? (
          <View style={styles.busyActions}>
            <View style={styles.searchingBar}>
              <ActivityIndicator size="small" color={IG.secondary} />
              <Text style={styles.searchingBarText}>Searching…</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={skipWithCooldown}
              style={styles.skipOutline}
            >
              <Text style={styles.skipOutlineText}>Skip</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Explore</Text>
    </View>
  );
}

function ModeTile({
  icon,
  label,
  sub,
  active,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.tile,
        active && styles.tileActive,
        disabled && styles.tileDisabled,
      ]}
    >
      <View style={[styles.tileIconWrap, active && styles.tileIconWrapActive]}>
        <Ionicons name={icon} size={28} color={active ? "#fff" : IG.text} />
      </View>
      <Text style={[styles.tileLabel, active && styles.tileLabelActive]}>
        {label}
      </Text>
      <Text style={styles.tileSub}>{sub}</Text>
      {active ? (
        <View style={styles.tileBadge}>
          <Ionicons name="checkmark" size={10} color="#fff" />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: IG.surface,
  },
  header: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    backgroundColor: IG.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: IG.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: IG.text,
    letterSpacing: -0.3,
  },
  scroll: {
    flex: 1,
    backgroundColor: APP_BG,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  hero: {
    alignItems: "center",
    marginBottom: 28,
    paddingVertical: 8,
  },
  heroIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: IG.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: IG.text,
    letterSpacing: -0.3,
  },
  heroSub: {
    marginTop: 6,
    fontSize: 14,
    color: IG.secondary,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: IG.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 2,
  },
  tileRow: {
    flexDirection: "row",
    gap: TILE_GAP,
  },
  tile: {
    width: TILE_W,
    backgroundColor: IG.surface,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 14,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: IG.border,
    position: "relative",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  tileActive: {
    borderColor: IG.black,
    backgroundColor: IG.surface,
  },
  tileDisabled: {
    opacity: 0.5,
  },
  tileIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: IG.muted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  tileIconWrapActive: {
    backgroundColor: IG.black,
  },
  tileLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: IG.text,
  },
  tileLabelActive: {
    color: IG.text,
  },
  tileSub: {
    marginTop: 4,
    fontSize: 12,
    color: IG.secondary,
  },
  tileBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: IG.black,
    alignItems: "center",
    justifyContent: "center",
  },
  statusCard: {
    marginTop: 28,
    backgroundColor: IG.surface,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: IG.border,
  },
  statusTitle: {
    marginTop: 14,
    fontSize: 17,
    fontWeight: "700",
    color: IG.text,
    textAlign: "center",
  },
  statusSub: {
    marginTop: 6,
    fontSize: 14,
    color: IG.secondary,
    textAlign: "center",
  },
  statusHandle: {
    marginTop: 4,
    fontSize: 14,
    color: IG.secondary,
  },
  searchPulse: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: IG.text,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNum: {
    fontSize: 26,
    fontWeight: "700",
    color: IG.text,
  },
  connectingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: IG.muted,
  },
  connectingText: {
    fontSize: 13,
    fontWeight: "600",
    color: IG.text,
  },
  avatarRingMd: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: IG.black,
  },
  avatarRingLg: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: IG.black,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 88 : 72,
    backgroundColor: IG.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: IG.border,
  },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: IG.black,
    paddingVertical: 14,
    borderRadius: 12,
  },
  joinIcon: {
    marginRight: 8,
  },
  joinText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  busyActions: {
    gap: 10,
  },
  searchingBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
  },
  searchingBarText: {
    fontSize: 14,
    color: IG.secondary,
    fontWeight: "500",
  },
  skipOutline: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: IG.border,
    backgroundColor: IG.surface,
  },
  skipOutlineText: {
    fontSize: 15,
    fontWeight: "600",
    color: IG.text,
  },
  callScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: IG.black,
    marginBottom: 24,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF3040",
  },
  liveText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  callName: {
    marginTop: 18,
    fontSize: 18,
    fontWeight: "700",
    color: IG.text,
  },
  callHandle: {
    marginTop: 4,
    fontSize: 14,
    color: IG.secondary,
  },
  callHint: {
    marginTop: 10,
    fontSize: 14,
    color: IG.secondary,
  },
});
