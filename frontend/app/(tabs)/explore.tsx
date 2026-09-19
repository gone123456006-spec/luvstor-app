import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppAlert } from "../../components/AppAlert";
import WhatsAppAvatar, {
  getDisplayName,
} from "../../components/WhatsAppAvatar";
import { useAuth } from "../../contexts/AuthContext";
import { useCall } from "../../contexts/CallContext";
import {
  ExplorePrefs,
  useExplore,
} from "../../contexts/ExploreContext";
import { useSocket } from "../../contexts/SocketContext";
import {
  getWebRTCUnavailableMessage,
  isWebRTCAvailable,
} from "../../services/webrtc";
import { getAuthToken } from "../../utils/auth";
import { resolveMediaUrl } from "../../utils/media";
import { getTabBarClearance } from "../../utils/navigation";
import { SHOW_ME_OPTIONS, type ShowMeValue } from "../../utils/showMe";
import {
  fetchSubscriptionStatus,
  formatExpiry,
  hasExplorePrefsAccess,
  initiateSubscriptionPurchase,
} from "../../utils/subscriptions";

const GIRL_IMG = require("../../assets/images/explore-girl.png");
const BOY_IMG = require("../../assets/images/explore-boy.png");

/** Luvstor theme — grey base + soft purple/rose gradients */
const T = {
  bg: "#F5F5F7",
  bgMid: "#EFE8F8",
  bgDeep: "#FFE8EE",
  surface: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#6B7280",
  muted: "#9CA3AF",
  border: "#E8E8ED",
  primary: "#370372",
  primaryDeep: "#2A0258",
  primarySoft: "#EFE8F8",
  primaryContainer: "#EFE8F8",
  rose: "#FF4B6E",
  roseSoft: "#FFE8EE",
  roseMid: "#FF4B6E",
  purpleSoft: "#EFE8F8",
  gold: "#F5C518",
  live: "#E53935",
};

function prefsSummary(prefs: ExplorePrefs) {
  if (prefs.showMe === "All") {
    return prefs.verifiedOnly ? "Verified only" : "Preferences";
  }
  const who =
    SHOW_ME_OPTIONS.find((o) => o.value === prefs.showMe)?.label || "Preferences";
  if (prefs.verifiedOnly) return `${who} · Verified only`;
  return who;
}

export default function ExploreScreen() {
  const { socket } = useSocket();
  const call = useCall();
  const { showAlert } = useAppAlert();
  const {
    mode,
    status,
    cooldownSec,
    matchedPeer,
    prefs,
    setPrefs,
    joinVideo,
    joinVoice,
    skipWithCooldown,
    leaveQueue,
  } = useExplore();

  const [prefsOpen, setPrefsOpen] = useState(false);

  const inExploreCall =
    call.isExplore && call.phase !== "idle" && call.phase !== "ended";

  const startExplore = useCallback(
    (nextMode: "video" | "voice") => {
      if (!socket?.connected) {
        showAlert({
          title: "Offline",
          message: "Connect to the internet and try again.",
        });
        return;
      }
      if (!isWebRTCAvailable()) {
        showAlert({
          title: "Calls unavailable",
          message: getWebRTCUnavailableMessage(),
        });
        return;
      }
      if (
        call.phase !== "idle" &&
        call.phase !== "ended" &&
        !call.isExplore
      ) {
        showAlert({
          title: "Busy",
          message: "Finish your chat call before joining Explore.",
        });
        return;
      }
      if (call.isExplore && call.phase !== "idle" && call.phase !== "ended") {
        showAlert({
          title: "Busy",
          message: "You are already in an Explore call.",
        });
        return;
      }
      if (nextMode === "video") joinVideo();
      else joinVoice();
    },
    [
      call.isExplore,
      call.phase,
      joinVideo,
      joinVoice,
      showAlert,
      socket?.connected,
    ],
  );

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
    return (
      <View style={styles.root}>
        <LinearGradient
          colors={[T.bg, T.bgMid, T.bg, T.bgDeep]}
          locations={[0, 0.28, 0.62, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
          <Header
            onPrefs={() => setPrefsOpen(true)}
            prefsLabel={prefsSummary(prefs)}
          />
          <LiveCallState
            name={matchedPeer?.name || call.peer?.name}
            publicId={matchedPeer?.publicId || call.peer?.publicId}
            photo={matchedPeer?.photo || call.peer?.photo}
            gender={matchedPeer?.gender || call.peer?.gender}
          />
          <ExplorePrefsSheet
            visible={prefsOpen}
            initial={prefs}
            onClose={() => setPrefsOpen(false)}
            onSave={(next) => {
              setPrefs(next);
              setPrefsOpen(false);
            }}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[T.bg, T.bgMid, T.bg, T.bgDeep]}
        locations={[0, 0.28, 0.62, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
        <Header
          onPrefs={() => setPrefsOpen(true)}
          prefsLabel={prefsSummary(prefs)}
        />

        <View style={styles.body}>
          {status === "idle" ? (
            <IdleHome
              onVideo={() => startExplore("video")}
              onVoice={() => startExplore("voice")}
            />
          ) : null}

          {status === "searching" ? (
            <SearchingState
              mode={mode}
              onSkip={skipWithCooldown}
              onLeave={leaveQueue}
            />
          ) : null}

          {status === "cooldown" ? (
            <CooldownState
              seconds={cooldownSec}
              mode={mode}
              onLeave={leaveQueue}
            />
          ) : null}

          {status === "matched" && matchedPeer ? (
            <MatchedState peer={matchedPeer} mode={mode} />
          ) : null}
        </View>

        <ExplorePrefsSheet
          visible={prefsOpen}
          initial={prefs}
          onClose={() => setPrefsOpen(false)}
          onSave={(next) => {
            setPrefs(next);
            setPrefsOpen(false);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function TabPadded({
  style,
  children,
}: {
  style?: object | object[];
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[style, { paddingBottom: getTabBarClearance(insets.bottom) }]}>
      {children}
    </View>
  );
}

function Header({
  onPrefs,
  prefsLabel,
}: {
  onPrefs: () => void;
  prefsLabel: string;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Explore</Text>
      <TouchableOpacity
        onPress={onPrefs}
        activeOpacity={0.75}
        style={styles.prefsChip}
        accessibilityRole="button"
        accessibilityLabel={`Preferences: ${prefsLabel}`}
      >
        <Ionicons name="options-outline" size={20} color={T.text} />
      </TouchableOpacity>
    </View>
  );
}

function IdleHome({
  onVideo,
  onVoice,
}: {
  onVideo: () => void;
  onVoice: () => void;
}) {
  return (
    <TabPadded style={styles.idle}>
      <View style={styles.idleHero}>
        <View style={styles.pairRow}>
          <View style={[styles.pairAvatar, styles.pairBoy]}>
            <Image
              source={BOY_IMG}
              style={styles.pairPhoto}
              contentFit="cover"
            />
          </View>
          <View style={[styles.pairAvatar, styles.pairGirl]}>
            <Image
              source={GIRL_IMG}
              style={styles.pairPhoto}
              contentFit="cover"
            />
          </View>
        </View>
      </View>

      <View style={styles.idleCopy}>
        <Text style={styles.idleTitle}>
          Ready to meet{" "}
          <Text style={styles.idleTitleAccent}>someone?</Text>
        </Text>
        <Text style={styles.idleSub}>
          Start a live video or voice match — connect, chat, and feel the vibe.
        </Text>
      </View>

      <View style={styles.actionRow}>
        <View style={styles.modeCard}>
          <View style={[styles.modeIconWrap, styles.modeIconVideo]}>
            <Ionicons name="videocam" size={22} color={T.primary} />
          </View>
          <Text style={styles.modeTitle}>Video</Text>
          <Text style={styles.modeHint}>See each other</Text>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onVideo}
            style={styles.startBtnPurple}
            accessibilityRole="button"
            accessibilityLabel="Start video explore"
          >
            <Text style={styles.startBtnText}>Start Video</Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={styles.modeCard}>
          <View style={[styles.modeIconWrap, styles.modeIconVoice]}>
            <Ionicons name="call" size={20} color={T.rose} />
          </View>
          <Text style={styles.modeTitle}>Voice</Text>
          <Text style={styles.modeHint}>Just talk</Text>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={onVoice}
            style={styles.startBtnPink}
            accessibilityRole="button"
            accessibilityLabel="Start voice explore"
          >
            <Text style={styles.startBtnText}>Start Voice</Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.idleFootRow}>
        <Ionicons name="shield-checkmark" size={14} color={T.muted} />
        <Text style={styles.idleFoot}>
          Verified profiles · Be kind · Safe community
        </Text>
      </View>
    </TabPadded>
  );
}

function ExplorePrefsSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: ExplorePrefs;
  onClose: () => void;
  onSave: (next: ExplorePrefs) => void;
}) {
  const { user } = useAuth();
  const { showAlert } = useAppAlert();
  const [showMe, setShowMe] = useState<ShowMeValue>(initial.showMe);
  const [verifiedOnly, setVerifiedOnly] = useState(initial.verifiedOnly);
  const [hasExplorePrefs, setHasExplorePrefs] = useState(false);
  const [planName, setPlanName] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const buyingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        setHasExplorePrefs(false);
        return;
      }
      const status = await fetchSubscriptionStatus(token);
      setHasExplorePrefs(hasExplorePrefsAccess(status));
      setPlanName(status.isActive ? status.planName : null);
    } catch {
      setHasExplorePrefs(false);
      setPlanName(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setShowMe(initial.showMe);
    setVerifiedOnly(initial.verifiedOnly);
    void refreshStatus();
  }, [visible, initial, refreshStatus]);

  const onSubscribe = useCallback(async () => {
    // Prevent double-tap / re-entry (Modal + Razorpay/Alert stacks freeze the app)
    if (buyingRef.current) return;
    buyingRef.current = true;
    setBuying(true);

    // Close prefs sheet FIRST — nested Modal + Razorpay/Alert freezes RN UI
    onClose();
    await new Promise((r) => setTimeout(r, 400));

    try {
      const token = await getAuthToken();
      if (!token) {
        showAlert({
          title: "Sign in required",
          message: "Please log in to subscribe.",
        });
        return;
      }
      const result = await initiateSubscriptionPurchase(
        token,
        "explore",
        "monthly",
        user?.name || "User",
        user?.email || "",
      );
      if (result.success) {
        await refreshStatus();
        const until = result.subscription?.expiresAt
          ? formatExpiry(result.subscription.expiresAt)
          : "";
        showAlert({
          title: "Explore Plus active",
          message: until
            ? `₹99/month unlocked until ${until}. Choose who you want to meet.`
            : "₹99/month unlocked. Choose who you want to meet.",
        });
      } else if (result.error && result.error !== "Payment cancelled") {
        showAlert({
          title: "Couldn’t subscribe",
          message: result.error,
        });
      }
    } catch (e: any) {
      showAlert({
        title: "Couldn’t subscribe",
        message: e?.message || "Something went wrong. Try again.",
      });
    } finally {
      buyingRef.current = false;
      setBuying(false);
    }
  }, [onClose, refreshStatus, showAlert, user?.email, user?.name]);

  const locked = !hasExplorePrefs;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetDismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Preferences</Text>
          <Text style={styles.sheetSub}>
            Who you want to meet on Explore
          </Text>

          {/* Explore Plus — ₹99 / month */}
          <View style={[styles.subCard, hasExplorePrefs && styles.subCardActive]}>
            <View style={styles.subCardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subCardTitle}>Explore Plus</Text>
                <Text style={styles.subCardPrice}>₹99 / month</Text>
              </View>
              {hasExplorePrefs ? (
                <View style={styles.subActivePill}>
                  <Text style={styles.subActivePillText}>
                    {planName || "Active"}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={onSubscribe}
                  disabled={buying || loadingStatus}
                  style={styles.subBuyBtn}
                >
                  {buying ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.subBuyBtnText}>Subscribe</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.sheetSection}>
            Show me{locked ? "  ·  Plus" : ""}
          </Text>
          <View style={styles.chipRow}>
            {SHOW_ME_OPTIONS.filter((opt) => opt.value !== "All").map((opt) => {
              const on = showMe === opt.value;
              const disabled = locked;
              return (
                <TouchableOpacity
                  key={opt.value}
                  activeOpacity={0.8}
                  disabled={disabled || buying}
                  onPress={() => {
                    if (disabled || buying) return;
                    // Tap again to clear back to all genders (no "Everyone" chip)
                    setShowMe(on ? "All" : opt.value);
                  }}
                  style={[
                    styles.chip,
                    on && styles.chipOn,
                    disabled && styles.chipLocked,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      on && styles.chipTextOn,
                      disabled && styles.chipTextLocked,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.toggleRow, locked && { opacity: 0.55 }]}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleTitle}>Verified only</Text>
              <Text style={styles.toggleSub}>
                {locked
                  ? "Unlock with Explore Plus · ₹99/mo"
                  : "Match with photo-verified profiles"}
              </Text>
            </View>
            <Switch
              value={locked ? false : verifiedOnly}
              disabled={locked || buying || loadingStatus}
              onValueChange={(v) => {
                if (locked || buying) return;
                setVerifiedOnly(v);
              }}
              trackColor={{ false: T.border, true: "#5A3A8A" }}
              thumbColor={!locked && verifiedOnly ? T.primary : "#f4f3f4"}
            />
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() =>
              onSave({
                showMe: locked ? "All" : showMe,
                verifiedOnly: locked ? false : verifiedOnly,
              })
            }
          >
            <LinearGradient
              colors={[T.primary, T.text]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.saveBtn}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SearchingState({
  mode,
  onSkip,
  onLeave,
}: {
  mode: "video" | "voice";
  onSkip: () => void;
  onLeave: () => void;
}) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
    const a = make(ring1, 0);
    const b = make(ring2, 900);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [ring1, ring2]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [
      {
        scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] }),
      },
    ],
  });

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <View style={styles.radarWrap}>
          <Animated.View style={[styles.radarRing, ringStyle(ring1)]} />
          <Animated.View style={[styles.radarRing, ringStyle(ring2)]} />
          <LinearGradient
            colors={[T.rose, T.primary]}
            style={styles.radarCore}
          >
            <Ionicons
              name={mode === "video" ? "videocam" : "call"}
              size={30}
              color="#fff"
            />
          </LinearGradient>
        </View>
        <Text style={styles.stateTitle}>Finding your match</Text>
        <Text style={styles.stateSub}>
          {mode === "video" ? "Someone to see" : "Someone to talk to"} · hang tight
        </Text>
      </View>

      <View style={styles.stateActions}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onSkip}
          style={styles.ghostBtn}
        >
          <Text style={styles.ghostBtnText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onLeave}
          style={styles.textBtn}
        >
          <Text style={styles.textBtnLabel}>Leave</Text>
        </TouchableOpacity>
      </View>
    </TabPadded>
  );
}

function CooldownState({
  seconds,
  mode,
  onLeave,
}: {
  seconds: number;
  mode: "video" | "voice";
  onLeave: () => void;
}) {
  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <View style={styles.countdown}>
          <Text style={styles.countdownNum}>{seconds}</Text>
        </View>
        <Text style={styles.stateTitle}>Next match soon</Text>
        <Text style={styles.stateSub}>
          Finding another {mode === "video" ? "video" : "voice"} match
        </Text>
      </View>
      <View style={styles.stateActions}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onLeave}
          style={styles.textBtn}
        >
          <Text style={styles.textBtnLabel}>Leave</Text>
        </TouchableOpacity>
      </View>
    </TabPadded>
  );
}

function MatchedState({
  peer,
  mode,
}: {
  peer: {
    name: string;
    publicId: string;
    photo?: string;
    gender?: string;
  };
  mode: "video" | "voice";
}) {
  const photo = resolveMediaUrl(peer.photo) || peer.photo || "";
  const name = getDisplayName(peer.name, peer.publicId);
  const pop = useRef(new Animated.Value(0.86)).current;

  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [pop]);

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <Text style={styles.matchBadge}>It{"'"}s a match</Text>
        <Animated.View
          style={[styles.matchAvatar, { transform: [{ scale: pop }] }]}
        >
          <LinearGradient
            colors={[T.rose, T.primary]}
            style={styles.matchRing}
          >
            <View style={styles.matchAvatarInner}>
              <WhatsAppAvatar
                name={peer.name}
                publicId={peer.publicId}
                photo={photo}
                gender={peer.gender}
                size={118}
                photoVerified={!!(peer as any).photoVerified}
              />
            </View>
          </LinearGradient>
        </Animated.View>
        <Text style={styles.matchName}>{name}</Text>
        {peer.publicId ? (
          <Text style={styles.matchHandle}>@{peer.publicId}</Text>
        ) : null}
        <View style={styles.connectingRow}>
          <ActivityIndicator size="small" color={T.primary} />
          <Text style={styles.connectingText}>
            Connecting {mode === "video" ? "video" : "voice"}…
          </Text>
        </View>
      </View>
    </TabPadded>
  );
}

function LiveCallState({
  name,
  publicId,
  photo,
  gender,
}: {
  name?: string;
  publicId?: string;
  photo?: string;
  gender?: string;
}) {
  const uri = resolveMediaUrl(photo) || photo || "";
  const display = getDisplayName(name, publicId);

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live now</Text>
        </View>
        <View style={styles.matchAvatar}>
          <LinearGradient
            colors={[T.rose, T.primary]}
            style={styles.matchRing}
          >
            <View style={styles.matchAvatarInner}>
              <WhatsAppAvatar
                name={name}
                publicId={publicId}
                photo={uri}
                gender={gender}
                size={118}
              />
            </View>
          </LinearGradient>
        </View>
        <Text style={styles.matchName}>{display}</Text>
        {publicId ? <Text style={styles.matchHandle}>@{publicId}</Text> : null}
        <Text style={styles.stateSub}>Controls are on the call screen</Text>
      </View>
    </TabPadded>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: "transparent",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -0.8,
  },
  prefsChip: {
    alignItems: "center",
    justifyContent: "center",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  body: {
    flex: 1,
  },

  idle: {
    flex: 1,
    paddingHorizontal: 22,
    justifyContent: "space-between",
  },
  idleHero: {
    alignItems: "center",
    justifyContent: "center",
    height: 200,
    marginTop: 16,
    marginBottom: 4,
  },
  pairRow: {
    width: 210,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  pairAvatar: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 59,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: T.surface,
    backgroundColor: T.surface,
  },
  pairBoy: {
    left: 0,
    transform: [{ translateY: 6 }],
    zIndex: 1,
  },
  pairGirl: {
    right: 0,
    transform: [{ translateY: -4 }],
    zIndex: 2,
  },
  pairPhoto: {
    width: "100%",
    height: "100%",
  },
  idleCopy: {
    alignItems: "center",
    paddingHorizontal: 8,
  },
  idleTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -0.6,
    lineHeight: 36,
    textAlign: "center",
  },
  idleTitleAccent: {
    color: T.primary,
  },
  idleSub: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: T.secondary,
    textAlign: "center",
    maxWidth: 300,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  modeCard: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: 20,
    paddingTop: 20,
    paddingBottom: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: T.border,
  },
  modeIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modeIconVideo: {
    backgroundColor: T.primarySoft,
  },
  modeIconVoice: {
    backgroundColor: T.roseSoft,
  },
  modeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: T.text,
  },
  modeHint: {
    marginTop: 3,
    marginBottom: 14,
    fontSize: 13,
    color: T.muted,
  },
  startBtnPurple: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "stretch",
    backgroundColor: T.primary,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  startBtnPink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "stretch",
    backgroundColor: T.rose,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  startBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  idleFootRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 4,
  },
  idleFoot: {
    fontSize: 12,
    lineHeight: 16,
    color: T.muted,
    ...(Platform.OS === "android" ? { includeFontPadding: false } : null),
  },

  /* Prefs sheet */
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheetDismiss: {
    flex: 1,
  },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D0D0D0",
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: T.text,
    letterSpacing: -0.3,
  },
  sheetSub: {
    marginTop: 4,
    marginBottom: 16,
    fontSize: 14,
    color: T.secondary,
  },
  subCard: {
    backgroundColor: T.primarySoft,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: T.border,
  },
  subCardActive: {
    borderColor: T.primary,
    backgroundColor: T.primarySoft,
  },
  subCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  subCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: T.text,
  },
  subCardPrice: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "600",
    color: T.primary,
  },
  subBuyBtn: {
    backgroundColor: T.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 96,
    alignItems: "center",
  },
  subBuyBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  subActivePill: {
    backgroundColor: T.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  subActivePillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  sheetSection: {
    fontSize: 13,
    fontWeight: "600",
    color: T.muted,
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginBottom: 22,
    width: "100%",
  },
  chip: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: T.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: {
    backgroundColor: T.primary,
  },
  chipLocked: {
    opacity: 0.55,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: T.text,
    textAlign: "center",
  },
  chipTextOn: {
    color: "#fff",
  },
  chipTextLocked: {
    color: T.muted,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 8,
    marginBottom: 24,
  },
  toggleCopy: {
    flex: 1,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: T.text,
  },
  toggleSub: {
    marginTop: 3,
    fontSize: 13,
    color: T.muted,
  },
  saveBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    borderRadius: 14,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  stateScreen: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  stateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    marginTop: 28,
    fontSize: 24,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  stateSub: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: T.secondary,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  stateActions: {
    gap: 8,
    alignItems: "center",
  },

  radarWrap: {
    width: 168,
    height: 168,
    alignItems: "center",
    justifyContent: "center",
  },
  radarRing: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: T.rose,
  },
  radarCore: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },

  countdown: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: T.rose,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  countdownNum: {
    fontSize: 38,
    fontWeight: "800",
    color: T.primary,
  },

  matchBadge: {
    marginBottom: 18,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: T.rose,
  },
  matchAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  matchRing: {
    padding: 4,
    borderRadius: 999,
  },
  matchAvatarInner: {
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: T.surface,
  },
  matchName: {
    marginTop: 20,
    fontSize: 26,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -0.5,
  },
  matchHandle: {
    marginTop: 4,
    fontSize: 15,
    color: T.muted,
  },
  connectingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  connectingText: {
    fontSize: 14,
    fontWeight: "500",
    color: T.secondary,
  },

  ghostBtn: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: T.border,
  },
  ghostBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: T.text,
  },
  textBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  textBtnLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: T.muted,
  },

  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: T.text,
    marginBottom: 20,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: T.live,
  },
  liveText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
