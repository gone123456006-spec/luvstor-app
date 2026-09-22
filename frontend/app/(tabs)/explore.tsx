import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { ensureSocketConnected } from "../../utils/ensureSocketConnected";
import { useStableBottomInset } from "../../hooks/useStableBottomInset";
import { useTabBarOverlayInset } from "../../hooks/useTabBarOverlayInset";
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

/** Luvstor Explore — soft purple/rose atmosphere */
const T = {
  bg: "#F7F4FA",
  bgMid: "#EDE4F7",
  bgDeep: "#FFE4EC",
  surface: "#FFFFFF",
  text: "#1A0A2E",
  secondary: "#5C5668",
  muted: "#9A93A8",
  border: "rgba(55, 3, 114, 0.08)",
  primary: "#370372",
  primaryDeep: "#24024D",
  primarySoft: "#F0E8FA",
  primaryMid: "#5A2FC7",
  rose: "#FF4B6E",
  roseSoft: "#FFE8EE",
  roseDeep: "#E8355A",
  gold: "#F5C518",
  live: "#E53935",
};

function prefsSummary(prefs: ExplorePrefs) {
  if (prefs.showMe === "All") {
    return prefs.verifiedOnly ? "Verified only" : "Preferences";
  }
  const who =
    SHOW_ME_OPTIONS.find((o) => o.value === prefs.showMe)?.label || "Preferences";
  if (prefs.verifiedOnly) return `${who} · Verified`;
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
      void (async () => {
        const ready = await ensureSocketConnected(socket);
        if (!ready) {
          showAlert({
            title: "Not connected",
            message:
              "Could not reach the server. Check your internet, wait a moment if the app just opened, and try again.",
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
      })();
    },
    [
      call.isExplore,
      call.phase,
      joinVideo,
      joinVoice,
      showAlert,
      socket,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        // Only leave the search queue — never tear down an active Explore call
        if (
          call.isExplore &&
          call.phase !== 'idle' &&
          call.phase !== 'ended'
        ) {
          return;
        }
        leaveQueue();
      };
    }, [call.isExplore, call.phase, leaveQueue]),
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
          colors={[T.bg, T.bgMid, "#F8F0F6", T.bgDeep]}
          locations={[0, 0.32, 0.68, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.orbPurple} pointerEvents="none" />
        <View style={styles.orbRose} pointerEvents="none" />
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <StatusBar barStyle="dark-content" backgroundColor={T.bg} />
          <Header
            onPrefs={() => setPrefsOpen(true)}
            prefsLabel={prefsSummary(prefs)}
          />
          <LiveCallState
            name=""
            publicId={
              matchedPeer?.publicId || call.peer?.publicId || ''
            }
            photo={matchedPeer?.photo || call.peer?.photo || ''}
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
        colors={[T.bg, T.bgMid, "#F8F0F6", T.bgDeep]}
        locations={[0, 0.32, 0.68, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.orbPurple} pointerEvents="none" />
      <View style={styles.orbRose} pointerEvents="none" />
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
  const bottom = useStableBottomInset();
  return (
    <View style={[style, { paddingBottom: getTabBarClearance(bottom) }]}>
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
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>Explore</Text>
      </View>
      <TouchableOpacity
        onPress={onPrefs}
        activeOpacity={0.75}
        style={styles.prefsChip}
        accessibilityRole="button"
        accessibilityLabel={`Preferences: ${prefsLabel}`}
      >
        <Ionicons name="options-outline" size={18} color={T.primary} />
        <Text style={styles.prefsChipText} numberOfLines={1}>
          {prefsLabel === "Preferences" ? "Filters" : prefsLabel}
        </Text>
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
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeIn, slideUp]);

  return (
    <TabPadded style={styles.idle}>
      <Animated.View
        style={[
          styles.idleTop,
          { opacity: fadeIn, transform: [{ translateY: slideUp }] },
        ]}
      >
        {/* WhatsApp-style overlapping profile banner */}
        <View style={styles.idleHero}>
          <View style={styles.pairBanner}>
            <View style={[styles.pairAvatar, styles.pairLeft]}>
              <Image
                source={BOY_IMG}
                style={styles.pairPhoto}
                contentFit="cover"
              />
            </View>
            <View style={[styles.pairAvatar, styles.pairRight]}>
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
            Meet someone{"\n"}
            <Text style={styles.idleTitleAccent}>right now</Text>
          </Text>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.idleBottom,
          { opacity: fadeIn, transform: [{ translateY: slideUp }] },
        ]}
      >
        <Text style={styles.callTypeLabel}>Select Call type</Text>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onVideo}
          style={styles.primaryCtaWrap}
          accessibilityRole="button"
          accessibilityLabel="Start video explore"
        >
          <LinearGradient
            colors={[T.primary, T.primaryMid]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.primaryCta}
          >
            <View style={styles.ctaIconBubble}>
              <Ionicons name="videocam" size={22} color={T.primary} />
            </View>
            <View style={styles.ctaCopy}>
              <Text style={styles.ctaTitle}>Start Video</Text>
              <Text style={styles.ctaHint}>Face-to-face match</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onVoice}
          style={styles.secondaryCta}
          accessibilityRole="button"
          accessibilityLabel="Start voice explore"
        >
          <View style={[styles.ctaIconBubble, styles.ctaIconRose]}>
            <Ionicons name="call" size={20} color={T.rose} />
          </View>
          <View style={styles.ctaCopy}>
            <Text style={styles.ctaTitleDark}>Start Voice</Text>
            <Text style={styles.ctaHintDark}>Talk without video</Text>
          </View>
          <Ionicons name="arrow-forward" size={18} color={T.primary} />
        </TouchableOpacity>

        <View style={styles.idleFootRow}>
          <Ionicons name="shield-checkmark" size={14} color={T.primaryMid} />
          <Text style={styles.idleFoot}>
            Safe · Skip anytime · Be kind
          </Text>
        </View>
      </Animated.View>
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
  const tabClearance = useTabBarOverlayInset();
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

  if (!visible) return null;

  return (
    <View style={styles.sheetHost} pointerEvents="box-none">
      <Pressable
        style={[styles.sheetDim, { bottom: tabClearance }]}
        onPress={onClose}
      />
      <View style={[styles.sheet, { marginBottom: tabClearance }]}>
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
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 2200,
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
    const b = make(ring2, 700);
    const c = make(ring3, 1400);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [ring1, ring2, ring3]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [
      {
        scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.05] }),
      },
    ],
  });

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <View style={styles.modeLivePill}>
          <Ionicons
            name={mode === "video" ? "videocam" : "call"}
            size={12}
            color={T.primary}
          />
          <Text style={styles.modeLiveText}>
            {mode === "video" ? "Video" : "Voice"} queue
          </Text>
        </View>
        <View style={styles.radarWrap}>
          <Animated.View
            style={[styles.radarRing, styles.radarRingRose, ringStyle(ring1)]}
          />
          <Animated.View
            style={[styles.radarRing, styles.radarRingPurple, ringStyle(ring2)]}
          />
          <Animated.View style={[styles.radarRing, ringStyle(ring3)]} />
          <LinearGradient
            colors={[T.rose, T.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.radarCore}
          >
            <Ionicons
              name={mode === "video" ? "videocam" : "call"}
              size={32}
              color="#fff"
            />
          </LinearGradient>
        </View>
        <Text style={styles.stateTitle}>Finding someone</Text>
        <Text style={styles.stateSub}>
          Matching you with an anonymous{" "}
          {mode === "video" ? "video" : "voice"} partner…
        </Text>
      </View>

      <View style={styles.stateActions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onSkip}
          style={styles.ghostBtn}
        >
          <Ionicons name="play-skip-forward" size={18} color={T.text} />
          <Text style={styles.ghostBtnText}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onLeave}
          style={styles.textBtn}
        >
          <Text style={styles.textBtnLabel}>Leave queue</Text>
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
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <Animated.View
          style={[styles.countdown, { transform: [{ scale: pulse }] }]}
        >
          <LinearGradient
            colors={[T.primarySoft, T.roseSoft]}
            style={styles.countdownInner}
          >
            <Text style={styles.countdownNum}>{seconds}</Text>
          </LinearGradient>
        </Animated.View>
        <Text style={styles.stateTitle}>Next match soon</Text>
        <Text style={styles.stateSub}>
          Looking for another anonymous {mode === "video" ? "video" : "voice"}{" "}
          partner
        </Text>
      </View>
      <View style={styles.stateActions}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={onLeave}
          style={styles.textBtn}
        >
          <Text style={styles.textBtnLabel}>Leave queue</Text>
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
  const id = String(peer.publicId || '').trim().toUpperCase();
  const photo = peer.photo || '';
  const pop = useRef(new Animated.Value(0.82)).current;
  const glow = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0.4,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, pop]);

  return (
    <TabPadded style={styles.stateScreen}>
      <View style={styles.stateCenter}>
        <View style={styles.matchBadgeWrap}>
          <LinearGradient
            colors={[T.rose, T.primaryMid]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.matchBadgeGrad}
          >
            <Text style={styles.matchBadge}>It{"'"}s a match</Text>
          </LinearGradient>
        </View>
        <Animated.View
          style={[
            styles.matchAvatar,
            {
              transform: [{ scale: pop }],
              opacity: glow.interpolate({
                inputRange: [0.4, 1],
                outputRange: [0.92, 1],
              }),
            },
          ]}
        >
          <LinearGradient
            colors={[T.rose, T.primary]}
            style={styles.matchRing}
          >
            <View style={styles.matchAvatarInner}>
              <WhatsAppAvatar
                name={id || 'Anonymous'}
                publicId={id}
                photo={photo}
                gender={peer.gender}
                size={118}
              />
            </View>
          </LinearGradient>
        </Animated.View>
        <Text style={styles.matchName}>{id || 'Anonymous'}</Text>
        <Text style={styles.matchAnonHint}>
          {id ? 'Name hidden · ID only' : 'Identity hidden'}
        </Text>
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
  const id = String(publicId || "").trim().toUpperCase();
  // Explore anonymity: DP + public ID only (ignore real name)
  const display = id || getDisplayName(name, publicId) || "Anonymous";

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
                name={display}
                publicId={id}
                photo={uri}
                gender={gender}
                size={118}
              />
            </View>
          </LinearGradient>
        </View>
        <Text style={styles.matchName}>{display}</Text>
        <Text style={styles.stateSub}>
          {id ? "Name hidden · ID only" : "Controls are on the call screen"}
        </Text>
      </View>
    </TabPadded>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.bg,
  },
  orbPurple: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(90, 47, 199, 0.12)",
  },
  orbRose: {
    position: "absolute",
    bottom: 120,
    left: -70,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(255, 75, 110, 0.10)",
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
    paddingTop: 4,
    paddingBottom: 10,
    gap: 12,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -1,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "500",
    color: T.muted,
    letterSpacing: -0.1,
  },
  prefsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
    ...Platform.select({
      ios: {
        shadowColor: T.primary,
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  prefsChipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
    color: T.primary,
  },
  body: {
    flex: 1,
  },

  idle: {
    flex: 1,
    paddingHorizontal: 22,
    justifyContent: "space-between",
  },
  idleTop: {
    alignItems: "center",
    paddingTop: 8,
  },
  idleBottom: {
    gap: 12,
    paddingBottom: 4,
  },
  anonPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(55, 3, 114, 0.08)",
    marginBottom: 18,
  },
  anonPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: T.primary,
    letterSpacing: 0.2,
  },
  idleHero: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    marginTop: 4,
  },
  pairBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pairAvatar: {
    width: 128,
    height: 128,
    borderRadius: 64,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#FFFFFF",
    backgroundColor: "#E8E0F5",
  },
  pairLeft: {
    marginRight: -32,
    zIndex: 1,
  },
  pairRight: {
    zIndex: 2,
  },
  pairPhoto: {
    width: "100%",
    height: "100%",
  },
  idleCopy: {
    alignItems: "center",
    paddingHorizontal: 6,
    marginTop: 6,
  },
  idleTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: T.text,
    letterSpacing: -0.8,
    lineHeight: 36,
    textAlign: "center",
  },
  idleTitleAccent: {
    color: T.primary,
  },
  callTypeLabel: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
    color: T.text,
    textAlign: "center",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  idleSub: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: T.secondary,
    textAlign: "center",
    maxWidth: 300,
  },
  primaryCtaWrap: {
    borderRadius: 22,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: T.primary,
        shadowOpacity: 0.28,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 5 },
    }),
  },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  secondaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  ctaIconBubble: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  ctaIconRose: {
    backgroundColor: T.roseSoft,
  },
  ctaCopy: {
    flex: 1,
  },
  ctaTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  ctaHint: {
    marginTop: 2,
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontWeight: "500",
  },
  ctaTitleDark: {
    color: T.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  ctaHintDark: {
    marginTop: 2,
    color: T.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  idleFootRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 6,
  },
  idleFoot: {
    fontSize: 12,
    lineHeight: 16,
    color: T.muted,
    fontWeight: "500",
    ...(Platform.OS === "android" ? { includeFontPadding: false } : null),
  },

  /* Prefs sheet — in-tree so footer tabs stay visible */
  sheetHost: {
    ...StyleSheet.absoluteFill,
    zIndex: 2000,
    elevation: 2000,
    justifyContent: "flex-end",
  },
  sheetDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(26, 10, 46, 0.45)",
  },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 16 : 12,
    zIndex: 1,
    elevation: 8,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.12)",
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
    color: T.text,
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
    backgroundColor: T.primary,
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
  modeLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: T.primarySoft,
    marginBottom: 22,
  },
  modeLiveText: {
    fontSize: 12,
    fontWeight: "700",
    color: T.primary,
  },

  radarWrap: {
    width: 180,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  radarRing: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: T.primaryMid,
  },
  radarRingRose: {
    borderColor: T.rose,
  },
  radarRingPurple: {
    borderColor: T.primary,
  },
  radarCore: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: T.primary,
        shadowOpacity: 0.35,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 8 },
    }),
  },

  countdown: {
    width: 108,
    height: 108,
    borderRadius: 54,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "rgba(55, 3, 114, 0.15)",
  },
  countdownInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownNum: {
    fontSize: 40,
    fontWeight: "800",
    color: T.primary,
  },

  matchBadgeWrap: {
    marginBottom: 20,
    borderRadius: 20,
    overflow: "hidden",
  },
  matchBadgeGrad: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  matchBadge: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#fff",
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
  matchAnonHint: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "600",
    color: T.muted,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 18,
    backgroundColor: T.surface,
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
