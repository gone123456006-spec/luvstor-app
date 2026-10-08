import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { SHOW_ROW_CHEVRON } from "../../utils/platformIcons";
import { SHOW_ME_OPTIONS, type ShowMeValue } from "../../utils/showMe";
import {
  fetchSubscriptionStatus,
  formatExpiry,
  hasExplorePrefsAccess,
  initiateSubscriptionPurchase,
} from "../../utils/subscriptions";
import { statusBarStyle, tc, themedPalette, themedStyles } from "../../utils/theme";

const GIRL_IMG = require("../../assets/images/explore-girl.png");
const BOY_IMG = require("../../assets/images/explore-boy.png");

/** Luvstor Explore — soft purple/rose atmosphere */
const T = themedPalette({
  bg: "#F5F5F7",
  surface: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#49454F",
  muted: "#79747E",
  border: "#E7E0EC",
  primary: "#370372",
  primarySoft: "#EFE8F8",
  rose: "#FF4B6E",
  roseSoft: "#FFE8EE",
  roseDeep: "#E8355A",
  online: "#25D366",
  danger: "#EA0038",
});

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

  const findingNext = status === "searching" || status === "cooldown";
  const inExploreCall =
    !findingNext &&
    call.isExplore &&
    call.phase !== "idle" &&
    call.phase !== "ended";

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
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <StatusBar barStyle={statusBarStyle()} backgroundColor={T.bg} />
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
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle={statusBarStyle()} backgroundColor={T.bg} />
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

          {status === "searching" || status === "cooldown" ? (
            <SearchingState
              mode={mode}
              cooldownSec={status === "cooldown" ? cooldownSec : 0}
              onSkip={skipWithCooldown}
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
  const filtered = prefsLabel !== "Preferences";
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Explore</Text>
      <TouchableOpacity
        onPress={onPrefs}
        activeOpacity={0.6}
        hitSlop={8}
        style={styles.headerIconBtn}
        accessibilityRole="button"
        accessibilityLabel={`Preferences: ${prefsLabel}`}
      >
        <Ionicons name="options-outline" size={24} color={T.text} />
        {filtered ? <View style={styles.headerDot} /> : null}
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
      <View style={styles.idleTop}>
        <View style={styles.pairBanner}>
          <View style={[styles.pairAvatar, styles.pairLeft]}>
            <Image source={BOY_IMG} style={styles.pairPhoto} contentFit="cover" />
          </View>
          <View style={styles.pairAvatar}>
            <Image source={GIRL_IMG} style={styles.pairPhoto} contentFit="cover" />
          </View>
        </View>
        <Text style={styles.idleTitle}>Meet someone new</Text>
        <Text style={styles.idleSub}>
          Start an anonymous video or voice call with a random person.
        </Text>
      </View>

      <View>
        <View style={styles.optionCard}>
          <OptionRow
            icon="videocam"
            title="Video call"
            subtitle="Face-to-face with someone new"
            onPress={onVideo}
          />
          <View style={styles.optionDivider} />
          <OptionRow
            icon="call"
            title="Voice call"
            subtitle="Talk without showing your face"
            onPress={onVoice}
          />
        </View>
        <View style={styles.idleFootRow}>
          <Ionicons name="lock-closed" size={12} color={T.muted} />
          <Text style={styles.idleFoot}>Anonymous · Skip anytime</Text>
        </View>
      </View>
    </TabPadded>
  );
}

function OptionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: tc("rgba(0,0,0,0.06)", "fg") }}
      style={({ pressed }) => [
        styles.optionRow,
        pressed && Platform.OS === "ios" && { backgroundColor: tc("#F2F2F2", "bg") },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Start ${title.toLowerCase()}`}
    >
      <View style={styles.optionIcon}>
        <Ionicons name={icon} size={22} color="#FFFFFF" />
      </View>
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSub}>{subtitle}</Text>
      </View>
      {SHOW_ROW_CHEVRON ? (
        <Ionicons name="chevron-forward" size={20} color={T.muted} />
      ) : null}
    </Pressable>
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
          <View style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>Save</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SearchingState({
  mode,
  cooldownSec = 0,
  onSkip,
  onLeave,
}: {
  mode: "video" | "voice";
  cooldownSec?: number;
  onSkip: () => void;
  onLeave: () => void;
}) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  const cooling = cooldownSec > 0;
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const modeLabel = mode === "video" ? "Video" : "Voice";

  return (
    <TabPadded style={styles.searchScreen}>
      <View style={styles.searchNote}>
        <Ionicons name="lock-closed" size={12} color={T.muted} />
        <Text style={styles.searchNoteText}>
          Anonymous · only your ID is shown
        </Text>
      </View>

      <View style={styles.searchCenter}>
        <View style={styles.searchAvatar}>
          <Ionicons name="person" size={68} color="#FFFFFF" />
        </View>
        <Text style={styles.searchTitle}>Finding someone</Text>
        <Text style={styles.searchStatus}>
          {cooling
            ? `Next match in ${cooldownSec}s`
            : `${modeLabel} · Searching ${mm}:${ss}`}
        </Text>
      </View>

      <View style={styles.searchActions}>
        <SearchAction
          icon="shuffle"
          label={cooling ? `${cooldownSec}s` : "Skip"}
          onPress={onSkip}
          disabled={cooling}
          primary
        />
        <SearchAction icon="close" label="Leave" onPress={onLeave} danger />
      </View>
    </TabPadded>
  );
}

function SearchAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
  primary,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
}) {
  const filled = danger || primary;
  return (
    <View style={styles.searchActionItem}>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.searchActionBtn,
          primary && styles.searchActionPrimary,
          danger && styles.searchActionDanger,
          disabled && { opacity: 0.45 },
        ]}
      >
        <Ionicons name={icon} size={26} color={filled ? "#FFFFFF" : T.text} />
      </TouchableOpacity>
      <Text style={styles.searchActionLabel}>{label}</Text>
    </View>
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
  const id = String(peer.publicId || "").trim().toUpperCase();
  return (
    <TabPadded style={styles.callScreen}>
      <View style={styles.searchNote}>
        <Ionicons name="lock-closed" size={12} color={T.muted} />
        <Text style={styles.searchNoteText}>Name hidden · ID only</Text>
      </View>
      <View style={styles.searchCenter}>
        <WhatsAppAvatar
          name={id || "Anonymous"}
          publicId={id}
          photo={peer.photo || ""}
          gender={peer.gender}
          size={128}
        />
        <Text style={styles.searchTitle}>{id || "Anonymous"}</Text>
        <Text style={styles.searchStatus}>
          Connecting {mode === "video" ? "video" : "voice"}…
        </Text>
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
    <TabPadded style={styles.callScreen}>
      <View style={styles.searchNote}>
        <Ionicons name="lock-closed" size={12} color={T.muted} />
        <Text style={styles.searchNoteText}>Name hidden · ID only</Text>
      </View>
      <View style={styles.searchCenter}>
        <WhatsAppAvatar
          name={display}
          publicId={id}
          photo={uri}
          gender={gender}
          size={128}
        />
        <Text style={styles.searchTitle}>{display}</Text>
        <View style={styles.onCallRow}>
          <View style={styles.onCallDot} />
          <Text style={[styles.searchStatus, { marginTop: 0 }]}>On call · controls are on the call screen</Text>
        </View>
      </View>
    </TabPadded>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.primary,
  },
  optionCard: {
    backgroundColor: T.surface,
    borderRadius: 16,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: T.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: T.text,
  },
  optionSub: {
    marginTop: 2,
    fontSize: 13,
    color: T.muted,
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.border,
    marginLeft: 76,
  },
  callScreen: {
    flex: 1,
    paddingHorizontal: 24,
  },
  onCallRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  onCallDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.online,
  },
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
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: T.text,
    letterSpacing: -0.3,
  },
  body: {
    flex: 1,
  },
  idle: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: "space-between",
  },
  idleTop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  pairBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pairAvatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: T.bg,
    backgroundColor: "#CFD8DC",
  },
  pairLeft: {
    marginRight: -24,
    zIndex: 1,
  },
  pairPhoto: {
    width: "100%",
    height: "100%",
  },
  idleTitle: {
    marginTop: 22,
    fontSize: 22,
    fontWeight: "600",
    color: T.text,
    textAlign: "center",
  },
  idleSub: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: T.muted,
    textAlign: "center",
    maxWidth: 300,
  },
  idleFootRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
    paddingBottom: 4,
  },
  idleFoot: {
    fontSize: 12,
    color: T.muted,
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
    backgroundColor: T.primary,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  searchScreen: {
    flex: 1,
    paddingHorizontal: 24,
  },
  searchNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingTop: 4,
  },
  searchNoteText: {
    fontSize: 12,
    color: T.muted,
  },
  searchCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 40,
  },
  searchAvatar: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "#CFD8DC",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  searchTitle: {
    marginTop: 22,
    fontSize: 24,
    fontWeight: "600",
    color: T.text,
    textAlign: "center",
  },
  searchStatus: {
    marginTop: 6,
    fontSize: 15,
    color: T.secondary,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  searchActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 56,
    paddingBottom: 12,
  },
  searchActionItem: {
    alignItems: "center",
    gap: 8,
  },
  searchActionBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
  },
  searchActionPrimary: {
    backgroundColor: T.primary,
    borderColor: T.primary,
  },
  searchActionDanger: {
    backgroundColor: "#EA0038",
    borderColor: "#EA0038",
  },
  searchActionLabel: {
    fontSize: 13,
    color: T.secondary,
  },
}),
);
