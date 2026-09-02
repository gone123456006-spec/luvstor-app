import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    Alert,
    Animated,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import Svg, {
    Circle,
    Defs,
    G,
    Line,
    Path,
    Stop,
    LinearGradient as SvgLinearGradient,
    Text as SvgText,
} from "react-native-svg";
import { nativeAlert } from "../../components/AppAlert";
import BonusCoin from "../../components/BonusCoin";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
} from "../../utils/auth";
import { claimDailySpin, fetchTokenBalance } from "../../utils/chatTokens";
import {
  getCachedTokenBalance,
  preloadTokenBalance,
  setCachedTokenBalance,
  updateCachedTokenBalance,
} from "../../utils/tokenCache";
import { initiateTokenPurchase } from "../../utils/payment";

const FALLBACK_AVATAR = require("../../assets/images/boy-image.png");

// ─────────────────────────────────────────────
// Wheel config
// ─────────────────────────────────────────────
const FREE_SPIN_CYCLE = [10, 10, 20, 10, 20, 10, 50];
const FESTIVAL_PALETTE = [
  { color: "#E63946", textColor: "#fff" },
  { color: "#FFB703", textColor: "#4A2500" },
  { color: "#9B5DE5", textColor: "#fff" },
  { color: "#F72585", textColor: "#fff" },
  { color: "#2A9D8F", textColor: "#fff" },
  { color: "#F4A261", textColor: "#4A2500" },
  { color: "#06D6A0", textColor: "#073B2A" },
];
const SPIN_SLICE_LABELS = [
  "LUCKY",
  "BONUS",
  "MEGA",
  "SUPER",
  "NICE",
  "WOW",
  "JACKPOT",
];
function segmentsFromCycle(cycle: number[]) {
  const jackpot = Math.max(...cycle, 0);
  return cycle.map((tokens, i) => {
    const isJackpot = tokens === jackpot && tokens >= 50;
    const pal = FESTIVAL_PALETTE[i % FESTIVAL_PALETTE.length];
    return {
      label: String(tokens),
      subLabel: isJackpot ? "JACKPOT" : SPIN_SLICE_LABELS[i % SPIN_SLICE_LABELS.length],
      tokens,
      color: isJackpot ? "#FFD166" : pal.color,
      textColor: isJackpot ? "#4A2500" : pal.textColor,
    };
  });
}

const { width: SCREEN_W } = Dimensions.get("window");
const WHEEL_SIZE = Math.min(SCREEN_W - 80, 248);
const R = WHEEL_SIZE / 2;
const SLICE_R = R - 18;
const TWO_PI = 2 * Math.PI;
const SCROLL_H_PAD = 20;
const AD_BANNER_W = SCREEN_W;
const AD_TILE = AD_BANNER_W / 6;
const AD_BANNER_H = AD_TILE * 3;

const PREMIUM_AD_PHOTOS = [
  require("../../assets/images/premium-ad/p1.png"),
  require("../../assets/images/premium-ad/p2.png"),
  require("../../assets/images/premium-ad/p3.png"),
  require("../../assets/images/premium-ad/p4.png"),
  require("../../assets/images/premium-ad/p5.png"),
  require("../../assets/images/premium-ad/p6.png"),
  require("../../assets/images/premium-ad/p7.png"),
  require("../../assets/images/premium-ad/p8.png"),
  require("../../assets/images/premium-ad/p9.png"),
  require("../../assets/images/premium-ad/p10.png"),
  require("../../assets/images/premium-ad/p11.png"),
  require("../../assets/images/premium-ad/p12.png"),
  require("../../assets/images/premium-ad/p13.png"),
  require("../../assets/images/premium-ad/p14.png"),
  require("../../assets/images/premium-ad/p15.png"),
  require("../../assets/images/premium-ad/p16.png"),
  require("../../assets/images/premium-ad/p17.png"),
  require("../../assets/images/premium-ad/p18.png"),
];

const TOKEN_PACKS = [
  { id: "10", count: 10, price: "₹10" },
  { id: "100", count: 100, price: "₹80" },
  { id: "500", count: 500, price: "₹350" },
  { id: "1000", count: 1000, price: "₹600", popular: true },
  { id: "5000", count: 5000, price: "₹2,000" },
  { id: "10000", count: 10000, price: "₹3,000" },
  { id: "50000", count: 50000, price: "₹10,000" },
  { id: "100000", count: 100000, price: "₹15,000", biggest: true },
] as const;

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

function buildSlicePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(4)} ${y1.toFixed(4)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(4)} ${y2.toFixed(4)} Z`;
}

const POPUP_BG = "#E5D39A";
const POPUP_HEADER = "#E8D48A";
const POPUP_CANCEL = "#DCC07A";
const POPUP_OK = "#A67C1A";
const POPUP_GOLD = "#F4C430";

function msUntilNextUtcDay(now = new Date()) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(0, next - now.getTime());
}

function waitParts(ms: number) {
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  return {
    hours: Math.floor(totalMin / 60),
    minutes: totalMin % 60,
  };
}

function SpinBonusPopup({
  visible,
  variant,
  tokensWon,
  onCancel,
  onPrimary,
}: {
  visible: boolean;
  variant: "wait" | "won";
  tokensWon?: number;
  onCancel: () => void;
  onPrimary: () => void;
}) {
  const [remainMs, setRemainMs] = React.useState(msUntilNextUtcDay);

  React.useEffect(() => {
    if (!visible || variant !== "wait") return;
    setRemainMs(msUntilNextUtcDay());
    const t = setInterval(() => setRemainMs(msUntilNextUtcDay()), 1000);
    return () => clearInterval(t);
  }, [visible, variant]);

  if (!visible) return null;

  const { hours, minutes } = waitParts(remainMs);
  const body =
    variant === "wait"
      ? `Come back in ${hours}h ${minutes}m for your next free spin.`
      : `You won ${tokensWon ?? 0} tokens. They have been added to your balance.`;

  return (
    <View style={styles.bonusOverlay} pointerEvents="box-none">
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onCancel}
      />
      <View style={styles.bonusCard}>
        <View style={styles.bonusHeader}>
          <View style={[styles.bonusBubble, styles.bonusBubbleLg]} />
          <View style={[styles.bonusBubble, styles.bonusBubbleSm]} />
          <View style={[styles.bonusBubble, styles.bonusBubbleMd]} />
        </View>
        <View style={styles.bonusCoinWrap} pointerEvents="none">
          <BonusCoin />
        </View>
        <View style={styles.bonusBody}>
          <Text style={styles.bonusText}>{body}</Text>
        </View>
        <View style={styles.bonusActions}>
          <TouchableOpacity
            style={[styles.bonusBtn, styles.bonusBtnCancel]}
            onPress={onCancel}
            activeOpacity={0.85}
          >
            <Text style={styles.bonusBtnCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bonusBtn, styles.bonusBtnPrimary]}
            onPress={onPrimary}
            activeOpacity={0.85}
          >
            <Text style={styles.bonusBtnText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function SunburstBg() {
  const vb = 400;
  const cx = 200;
  const cy = 175;
  const rayCount = 24;
  const arc = TWO_PI / rayCount;
  const radius = 290;
  return (
    <View style={styles.sunburstBg} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${vb} ${vb}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ backgroundColor: "transparent" }}
      >
        {Array.from({ length: rayCount }).map((_, i) => {
          const a0 = -Math.PI / 2 + i * arc;
          const a1 = a0 + arc;
          return (
            <Path
              key={i}
              d={buildSlicePath(cx, cy, radius, a0, a1)}
              fill={i % 2 === 0 ? "#E8D48A" : "#DCC07A"}
            />
          );
        })}
      </Svg>
    </View>
  );
}

// ─────────────────────────────────────────────
// SpinModal (Updated to 1 Free Spin per day)
// ─────────────────────────────────────────────
interface SpinModalProps {
  visible: boolean;
  onClose: () => void;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  canSpinToday: boolean;
  spinsRemaining: number;
  spinsPerDay: number;
  spinCycle: number[];
  onSpinAvailabilityChange: (canSpin: boolean, remaining?: number) => void;
}

function SpinModal({
  visible,
  onClose,
  balance,
  onBalanceChange,
  canSpinToday: _canSpinToday,
  spinsRemaining,
  spinsPerDay,
  spinCycle,
  onSpinAvailabilityChange,
}: SpinModalProps) {
  const segments = React.useMemo(() => segmentsFromCycle(FREE_SPIN_CYCLE), []);
  const n = segments.length;
  const arc = TWO_PI / n;
  const rotAnim = React.useRef(new Animated.Value(0)).current;
  const currentRot = React.useRef(0);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [spinsLeft, setSpinsLeft] = React.useState(spinsRemaining);
  const [result, setResult] = React.useState<(typeof segments)[0] | null>(null);
  const [waitOpen, setWaitOpen] = React.useState(false);
  const slideAnim = React.useRef(new Animated.Value(300)).current;
  const dotCount = Math.min(Math.max(spinsPerDay, 1), 8);

  React.useEffect(() => {
    setSpinsLeft(spinsRemaining);
  }, [spinsRemaining, visible]);

  React.useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 6,
      }).start();
    } else {
      slideAnim.setValue(300);
      setWaitOpen(false);
      setResult(null);
    }
  }, [visible]);

  async function doSpin() {
    if (isSpinning) return;
    if (spinsLeft <= 0) {
      setWaitOpen(true);
      return;
    }

    setResult(null);
    setIsSpinning(true);

    try {
      const token = await getAuthToken();
      if (!token) {
        setIsSpinning(false);
        nativeAlert("Sign in required", "Please log in to spin.");
        return;
      }

      // Server picks the win and credits tokenBalance (same balance chat uses)
      const claim = await claimDailySpin(token);
      if (!claim.success || claim.winIndex < 0) {
        setIsSpinning(false);
        const remaining = claim.spinsRemaining ?? 0;
        setSpinsLeft(remaining);
        onSpinAvailabilityChange(remaining > 0, remaining);
        onBalanceChange(claim.tokenBalance ?? balance);
        if (claim.error && claim.code !== "SPIN_LIMIT_REACHED") {
          nativeAlert("Spin failed", claim.error);
          return;
        }
        setWaitOpen(true);
        return;
      }

      const remaining = claim.spinsRemaining ?? 0;
      setSpinsLeft(remaining);
      onSpinAvailabilityChange(remaining > 0, remaining);

      const winIdx = Math.max(0, Math.min(n - 1, claim.winIndex));
      const offset = (Math.random() * 0.6 - 0.3) * arc;
      const targetLocal = (winIdx + 0.5) * arc + offset;
      const normalised = ((-targetLocal % TWO_PI) + TWO_PI) % TWO_PI;
      const currentNorm = ((currentRot.current % TWO_PI) + TWO_PI) % TWO_PI;

      let delta = normalised - currentNorm;
      if (delta <= 0) delta += TWO_PI;
      const extraRot = (6 + Math.floor(Math.random() * 3)) * TWO_PI;
      const totalRad = extraRot + delta;
      const totalDeg = (totalRad * 180) / Math.PI;
      const startDeg = (currentRot.current * 180) / Math.PI;

      rotAnim.setValue(startDeg % 360);

      Animated.timing(rotAnim, {
        toValue: startDeg + totalDeg,
        duration: 4500,
        easing: easeOut,
        useNativeDriver: true,
      }).start(() => {
        currentRot.current = (currentRot.current + totalRad) % TWO_PI;
        setIsSpinning(false);
        const won = segments[winIdx];
        setResult(won);
        onBalanceChange(claim.tokenBalance);
      });
    } catch {
      setIsSpinning(false);
      nativeAlert("Spin failed", "Could not claim spin. Try again.");
    }
  }

  const spinDeg = rotAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalDismiss}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.modalSheet,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.modalSheetInner}>
            <SunburstBg />

            <View style={styles.dotsRow}>
              <Text style={styles.dotsLabel}>Spins left</Text>
              {Array.from({ length: dotCount }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i >= spinsLeft && styles.dotUsed]}
                />
              ))}
            </View>

            <View style={styles.wheelWrap}>
              <Animated.View
                style={{
                  transform: [{ rotate: spinDeg }],
                  width: WHEEL_SIZE,
                  height: WHEEL_SIZE,
                  backgroundColor: "transparent",
                }}
              >
                <Svg
                  width={WHEEL_SIZE}
                  height={WHEEL_SIZE}
                  style={{ backgroundColor: "transparent" }}
                >
                  <Defs>
                    <SvgLinearGradient
                      id="metalGold"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <Stop offset="0%" stopColor="#F0D56A" />
                      <Stop offset="16%" stopColor="#E8C547" />
                      <Stop offset="38%" stopColor="#A67C1A" />
                      <Stop offset="55%" stopColor="#F3D56A" />
                      <Stop offset="72%" stopColor="#7A5A12" />
                      <Stop offset="88%" stopColor="#D4B24A" />
                      <Stop offset="100%" stopColor="#5C440C" />
                    </SvgLinearGradient>
                    <SvgLinearGradient
                      id="metalBevel"
                      x1="100%"
                      y1="0%"
                      x2="0%"
                      y2="100%"
                    >
                      <Stop offset="0%" stopColor="#6B5010" />
                      <Stop offset="45%" stopColor="#E6C35A" />
                      <Stop offset="100%" stopColor="#E8C547" />
                    </SvgLinearGradient>
                  </Defs>

                  <Circle cx={R} cy={R} r={R - 1} fill="url(#metalGold)" />
                  <Circle cx={R} cy={R} r={R - 11} fill="url(#metalBevel)" />
                  <Circle cx={R} cy={R} r={SLICE_R + 1} fill="#1A1208" />

                  {segments.map((seg, i) => {
                    const startAngle = -Math.PI / 2 + i * arc;
                    const endAngle = startAngle + arc;
                    const midAngle = startAngle + arc / 2;
                    const d = buildSlicePath(
                      R,
                      R,
                      SLICE_R,
                      startAngle,
                      endAngle,
                    );
                    const textR = SLICE_R * 0.6;
                    const tx = R + textR * Math.cos(midAngle);
                    const ty = R + textR * Math.sin(midAngle);
                    const rotDeg = (midAngle * 180) / Math.PI;
                    const lines = seg.label.split("\n");

                    return (
                      <G key={i}>
                        <Path d={d} fill={seg.color} />
                        <Line
                          x1={R}
                          y1={R}
                          x2={R + SLICE_R * Math.cos(startAngle)}
                          y2={R + SLICE_R * Math.sin(startAngle)}
                          stroke="#C9A227"
                          strokeWidth={1.6}
                        />
                        {lines.map((line, li) => (
                          <SvgText
                            key={li}
                            x={tx}
                            y={
                              ty +
                              (li - (lines.length - 1) / 2) * 12 -
                              (lines.length === 1 ? 4 : 0)
                            }
                            fill={seg.textColor}
                            fontSize={lines.length > 1 ? 11 : 14}
                            fontWeight="800"
                            textAnchor="middle"
                            rotation={rotDeg}
                            originX={tx}
                            originY={ty}
                          >
                            {line}
                          </SvgText>
                        ))}
                        {lines.length === 1 && (
                          <SvgText
                            x={tx}
                            y={ty + 11}
                            fill={seg.textColor}
                            fontSize={8}
                            fontWeight="700"
                            textAnchor="middle"
                            opacity={0.9}
                            rotation={rotDeg}
                            originX={tx}
                            originY={ty}
                          >
                            {seg.subLabel}
                          </SvgText>
                        )}
                      </G>
                    );
                  })}

                  <Circle
                    cx={R}
                    cy={R}
                    r={SLICE_R}
                    fill="none"
                    stroke="#8A6A18"
                    strokeWidth={1.4}
                  />
                  <Circle cx={R} cy={R} r={44} fill="url(#metalGold)" />
                  <Circle cx={R} cy={R} r={37} fill="#1A1208" />
                </Svg>
              </Animated.View>

              <View style={styles.goHub} pointerEvents="box-none">
                <TouchableOpacity
                  style={styles.wheelCenterBtn}
                  onPress={doSpin}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={["#F0D56A", "#D4A017", "#8A6A18", "#E8C547"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.goRing}
                  >
                    <View style={styles.goInner}>
                      <Text style={styles.wheelCenterText}>GO!</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
                <View style={styles.goPointer} pointerEvents="none" />
              </View>
            </View>
          </View>
        </Animated.View>

        <SpinBonusPopup
          visible={waitOpen}
          variant="wait"
          onCancel={() => setWaitOpen(false)}
          onPrimary={() => setWaitOpen(false)}
        />
        <SpinBonusPopup
          visible={!!result}
          variant="won"
          tokensWon={result?.tokens ?? 0}
          onCancel={() => setResult(null)}
          onPrimary={() => setResult(null)}
        />
      </View>
    </Modal>
  );
}

function PremiumAdBanner({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.adBannerWrap}
      activeOpacity={0.92}
      onPress={onPress}
    >
      <View style={styles.adPhotoWall}>
        {PREMIUM_AD_PHOTOS.map((src, i) => (
          <Image
            key={i}
            source={src}
            style={styles.adPhotoTile}
            contentFit="cover"
          />
        ))}
      </View>
      <LinearGradient
        colors={[
          "rgba(0,0,0,0.08)",
          "rgba(12,4,10,0.45)",
          "rgba(12,4,10,0.92)",
        ]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.adCopy}>
        <Text style={styles.adKicker}>Luvstor Premium</Text>
        <Text style={styles.adTitle}>Get Premium</Text>
        <Text style={styles.adSub}>
          Meet more people · Blue tick · Extra spins
        </Text>
        <View style={styles.adCta}>
          <Text style={styles.adCtaText}>View plans</Text>
          <Ionicons name="chevron-forward" size={14} color="#1A1208" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────
// Main TokenScreen
// ─────────────────────────────────────────────
export default function TokenScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);
  const tokenSectionY = React.useRef(0);
  const initialSnapshot = React.useMemo(() => getCachedTokenBalance(), []);

  const scrollToTokenPacks = React.useCallback(() => {
    scrollRef.current?.scrollTo({
      y: Math.max(tokenSectionY.current - 8, 0),
      animated: true,
    });
  }, []);
  const [balance, setBalance] = React.useState(
    initialSnapshot?.tokenBalance ?? 0,
  );
  const [canSpinToday, setCanSpinToday] = React.useState(
    initialSnapshot?.canSpinToday ?? true,
  );
  const [spinsRemaining, setSpinsRemaining] = React.useState(
    initialSnapshot?.spinsRemaining ?? 1,
  );
  const [spinsPerDay, setSpinsPerDay] = React.useState(
    initialSnapshot?.spinsPerDay ?? 1,
  );
  const [loadingBalance, setLoadingBalance] = React.useState(!initialSnapshot);
  const [spinModalOpen, setSpinModalOpen] = React.useState(false);
  const [selectedPackId, setSelectedPackId] = React.useState<string>("1000");
  const [buying, setBuying] = React.useState(false);
  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(null);
  const [userName, setUserName] = React.useState<string>("");
  const [userEmail, setUserEmail] = React.useState<string>("");
  const [spinCycle, setSpinCycle] = React.useState<number[]>(FREE_SPIN_CYCLE);

  const applyBalanceData = React.useCallback(
    (data: Awaited<ReturnType<typeof fetchTokenBalance>>) => {
      setBalance(data.tokenBalance ?? 0);
      setCanSpinToday(!!data.canSpinToday);
      setSpinsRemaining(data.spinsRemaining ?? (data.canSpinToday ? 1 : 0));
      setSpinsPerDay(data.spinsPerDay ?? 1);
      setSpinCycle(FREE_SPIN_CYCLE);
      setCachedTokenBalance(data);
    },
    [],
  );

  const loadBalance = React.useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoadingBalance(true);
      }
      try {
        const token = await getAuthToken();
        if (!token) {
          setBalance(0);
          return;
        }
        const data = await preloadTokenBalance(token, { force: true });
        if (data) {
          applyBalanceData(data);
        }
      } catch (e: any) {
        console.warn(
          "Failed to load token balance:",
          e?.message || "network error",
        );
      } finally {
        setLoadingBalance(false);
      }
    },
    [applyBalanceData],
  );

  const buySelectedPack = React.useCallback(async () => {
    const pack = TOKEN_PACKS.find((p) => p.id === selectedPackId);
    if (!pack || buying) return;
    setBuying(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        Alert.alert("Sign in required", "Please log in to buy tokens.");
        return;
      }

      // Initiate Razorpay payment
      const result = await initiateTokenPurchase(
        token,
        pack.id,
        userName,
        userEmail,
      );

      if (!result.success) {
        if (result.error !== "Payment cancelled") {
          Alert.alert("Purchase failed", result.error || "Try again");
        }
        return;
      }

      // Update balance after successful payment
      if (result.tokenBalance !== undefined) {
        setBalance(result.tokenBalance);
        updateCachedTokenBalance({ tokenBalance: result.tokenBalance });
      }

      Alert.alert(
        "Payment Successful",
        `${pack.count.toLocaleString()} tokens have been added to your balance.`,
        [{ text: "OK" }],
      );

      // Reload balance to ensure sync
      await loadBalance();
    } catch (error: any) {
      console.error("Purchase error:", error);
      Alert.alert(
        "Purchase failed",
        "Could not complete the purchase. Please try again.",
      );
    } finally {
      setBuying(false);
    }
  }, [selectedPackId, buying, userName, userEmail, loadBalance]);

  useFocusEffect(
    React.useCallback(() => {
      const cached = getCachedTokenBalance();
      loadBalance({ silent: !!cached });
      (async () => {
        try {
          const authUser = await getCurrentAuthUser();
          if (!authUser?.email) return;
          const parsed = await getLocalProfile(authUser.email);
          setProfilePhoto(parsed?.photo || null);
          setUserName(parsed?.name || "");
          setUserEmail(authUser.email || "");
        } catch {
          /* ignore */
        }
      })();
    }, [loadBalance]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["left", "right", "bottom"]}>
      <View style={styles.page}>
        <View
          style={[
            styles.stickyHeader,
            { paddingTop: Math.max(insets.top - 6, 4) },
          ]}
        >
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Tokens</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerAvatarBtn}
              activeOpacity={0.8}
              onPress={() => router.push("/(tabs)/profile")}
            >
              {profilePhoto ? (
                <Image
                  source={{ uri: profilePhoto }}
                  style={styles.headerAvatar}
                  contentFit="cover"
                />
              ) : (
                <Image
                  source={FALLBACK_AVATAR}
                  style={styles.headerAvatar}
                  contentFit="cover"
                />
              )}
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom:
                Platform.OS === "android"
                  ? insets.bottom + 110
                  : insets.bottom + 48,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.balanceCard}>
            <View style={styles.balanceTopRow}>
              <View style={styles.balanceTopLeft}>
                <Text style={styles.balanceCardLabel}>Your Balance</Text>
                <View style={styles.balanceAmountRow}>
                  <BonusCoin size={22} iconSize={11} />
                  <Text style={styles.balanceCardAmount}>
                    {loadingBalance ? "…" : balance.toLocaleString()}
                  </Text>
                  <Text style={styles.balanceCardUnit}>tokens</Text>
                </View>
              </View>
            </View>

            <View style={styles.balanceActions}>
              <TouchableOpacity
                style={styles.balanceBtnOutline}
                activeOpacity={0.85}
                onPress={scrollToTokenPacks}
              >
                <Text style={styles.balanceBtnOutlineText}>Get Coin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.balanceBtnFilled}
                activeOpacity={0.85}
                onPress={() => router.push("/subscription" as any)}
              >
                <Text style={styles.balanceBtnFilledText}>Buy Pro</Text>
              </TouchableOpacity>
            </View>
          </View>

          <PremiumAdBanner
            onPress={() => router.push("/subscription" as any)}
          />

          {/* Daily Lucky Spin */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setSpinModalOpen(true)}
            style={styles.spinCardWrap}
          >
            <LinearGradient
              colors={["#6B1245", "#C23A22", "#E07A14"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.spinCard}
            >
              <View style={styles.spinIconBg}>
                <BonusCoin size={44} iconSize={22} />
              </View>
              <View style={styles.spinTextContainer}>
                <Text style={styles.spinCardTitle}>Lucky Spin</Text>
                <Text
                  style={styles.spinCardSub}
                  numberOfLines={1}
                  {...(Platform.OS === "android"
                    ? {
                        adjustsFontSizeToFit: true,
                        minimumFontScale: 0.82,
                      }
                    : {})}
                >
                  Get free tokens — spin to win!
                </Text>
              </View>
              <Text
                style={[
                  styles.spinStatus,
                  !canSpinToday && styles.spinStatusUsed,
                ]}
              >
                {canSpinToday
                  ? spinsRemaining > 1
                    ? `${spinsRemaining} left`
                    : "Open"
                  : "Used"}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#FFE7B8" />
            </LinearGradient>
          </TouchableOpacity>

          <View
            onLayout={(e) => {
              tokenSectionY.current = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionTitle}>Get more tokens</Text>
            <Text style={styles.sectionSubtitle}>
              Select a pack and add tokens to your balance
            </Text>

            <View style={styles.planList}>
              {TOKEN_PACKS.map((pack, index) => {
                const selected = selectedPackId === pack.id;
                return (
                  <TouchableOpacity
                    key={pack.id}
                    style={[
                      styles.planRow,
                      index === 0 && styles.planRowFirst,
                      index === TOKEN_PACKS.length - 1 && styles.planRowLast,
                      selected && styles.planRowSelected,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => setSelectedPackId(pack.id)}
                  >
                    <View style={styles.planInfo}>
                      <View style={styles.planTitleRow}>
                        <BonusCoin size={18} />
                        <Text style={styles.planTitle}>
                          {pack.count.toLocaleString()} tokens
                        </Text>
                        {"popular" in pack && pack.popular ? (
                          <View style={styles.planPopularTag}>
                            <Text style={styles.planPopularText}>Popular</Text>
                          </View>
                        ) : null}
                        {"biggest" in pack && pack.biggest ? (
                          <View style={styles.planBiggestTag}>
                            <Text style={styles.planBiggestText}>
                              Biggest deal
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <Text
                      style={[
                        styles.planPrice,
                        selected && styles.planPriceSelected,
                      ]}
                    >
                      {pack.price}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.continueBtn, buying && styles.continueBtnDisabled]}
              activeOpacity={0.85}
              disabled={buying}
              onPress={buySelectedPack}
            >
              <Text style={styles.continueBtnText}>
                {buying ? "Processing…" : "Buy Tokens"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* Spin Modal */}
      <SpinModal
        visible={spinModalOpen}
        onClose={() => {
          setSpinModalOpen(false);
          loadBalance();
        }}
        balance={balance}
        onBalanceChange={(next) => {
          setBalance(next);
          updateCachedTokenBalance({ tokenBalance: next });
        }}
        canSpinToday={canSpinToday}
        spinsRemaining={spinsRemaining}
        spinsPerDay={spinsPerDay}
        spinCycle={spinCycle}
        onSpinAvailabilityChange={(canSpin, remaining) => {
          setCanSpinToday(canSpin);
          if (remaining !== undefined) setSpinsRemaining(remaining);
        }}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },
  page: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  stickyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: "transparent",
  },
  headerLeft: {
    flex: 1,
    paddingRight: 12,
    minWidth: 0,
  },
  title: {
    fontSize: 21,
    fontWeight: "600",
    color: "#111B21",
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#8A8A8A",
    lineHeight: 18,
  },
  headerHeart: {
    fontSize: 12,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerAvatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
  },
  headerAvatar: {
    width: "100%",
    height: "100%",
  },

  // Balance — full-bleed card
  balanceCard: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 12,
  },
  balanceTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  balanceTopLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  balanceCardLabel: {
    fontSize: 13,
    color: "#667781",
    marginBottom: 4,
  },
  balanceAmountRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  balanceCardAmount: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111B21",
    letterSpacing: -0.5,
  },
  balanceCardUnit: {
    fontSize: 14,
    color: "#667781",
    fontWeight: "500",
    marginBottom: 2,
  },
  balanceActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  balanceBtnOutline: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  balanceBtnOutlineText: {
    color: "#374151",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  balanceBtnFilled: {
    flex: 1,
    backgroundColor: "#111B21",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  balanceBtnFilledText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  adBannerWrap: {
    marginHorizontal: -20,
    marginBottom: 16,
    height: AD_BANNER_H,
    overflow: "hidden",
    backgroundColor: "#1A0A14",
  },
  adPhotoWall: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  adPhotoTile: {
    width: AD_TILE,
    height: AD_TILE,
  },
  adCopy: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
  },
  adKicker: {
    color: "#FFD166",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  adTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  adSub: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
    marginBottom: 10,
  },
  adCta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD166",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  adCtaText: {
    color: "#1A1208",
    fontSize: 13,
    fontWeight: "800",
  },

  // Daily Lucky Spin
  spinCardWrap: {
    marginHorizontal: -20,
    marginBottom: 24,
    overflow: "hidden",
  },
  spinCard: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 209, 102, 0.45)",
  },
  spinIconBg: {
    marginRight: 12,
    backgroundColor: "transparent",
  },
  spinTextContainer: {
    flex: 1,
    minWidth: 0,
  },
  spinCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFF6D6",
    marginBottom: 2,
  },
  spinCardSub: {
    fontSize: 13,
    color: "rgba(255,246,214,0.82)",
    ...(Platform.OS === "android" ? { includeFontPadding: false } : null),
  },
  spinFree: {
    color: "#FFD166",
    fontWeight: "800",
  },
  spinStatus: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFD166",
    marginRight: 4,
  },
  spinStatusUsed: {
    color: "rgba(255,246,214,0.7)",
    fontWeight: "600",
  },

  // Subscription-style token packs
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111B21",
    marginBottom: 4,
    textAlign: "center",
  },
  sectionSubtitle: {
    fontSize: 13,
    color: "#667781",
    marginBottom: 14,
    lineHeight: 18,
    textAlign: "center",
  },
  planList: {
    backgroundColor: "#fff",
    marginHorizontal: -20,
    overflow: "hidden",
    marginBottom: 14,
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E9EDEF",
    backgroundColor: "#fff",
  },
  planRowFirst: {
    borderTopWidth: 0,
  },
  planRowLast: {},
  planRowSelected: {
    backgroundColor: "#F3F4F6",
  },
  planRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#C5C5C5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  planRadioSelected: {
    borderColor: "#111B21",
  },
  planRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#111B21",
  },
  planInfo: {
    flex: 1,
    minWidth: 0,
  },
  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  planPopularTag: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planPopularText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
  },
  planBiggestTag: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planBiggestText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
  },
  planPrice: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
    marginLeft: 8,
  },
  planPriceSelected: {
    color: "#111B21",
  },
  continueBtn: {
    height: 46,
    borderRadius: 10,
    backgroundColor: "#111B21",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  continueBtnDisabled: {
    opacity: 0.5,
  },
  continueBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  // Modal — festival fair (half-screen sheet)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalDismiss: {
    flex: 1,
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  modalSheetInner: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#E5D39A",
  },
  sunburstBg: {
    ...StyleSheet.absoluteFillObject,
  },
  modalHeader: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  modalKicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: "#FFD166",
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFF6D6",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(122, 62, 0, 0.25)",
  },

  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 6,
  },
  dotsLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7A3E00",
    marginRight: 2,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#E07A14",
    marginHorizontal: 2,
  },
  dotUsed: { backgroundColor: "rgba(122, 62, 0, 0.22)" },

  wheelWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    marginTop: 6,
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
  },
  svgPointer: {
    position: "absolute",
    top: -12,
    zIndex: 10,
    alignSelf: "center",
  },

  goHub: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 12,
  },
  goPointer: {
    position: "absolute",
    top: "50%",
    marginTop: -55,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 16,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#6C2BD9",
  },
  wheelCenterBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
    shadowColor: "#3A2400",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
  },
  goRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
  },
  goInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#5B21B6",
    borderWidth: 1.5,
    borderColor: "rgba(255, 243, 196, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  wheelCenterText: {
    color: "#FFE566",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.6,
    textShadowColor: "rgba(60, 16, 110, 0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  modalSpinBtn: {
    width: "100%",
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "rgba(233, 30, 140, 0.55)",
  },
  modalSpinBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  modalSpinBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  spinBtnDisabled: { opacity: 0.55 },
  spinNote: {
    fontSize: 11,
    color: "rgba(255,246,214,0.78)",
    marginBottom: 10,
    textAlign: "center",
    lineHeight: 15,
    paddingHorizontal: 4,
  },

  bonusOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 28,
    zIndex: 40,
  },
  bonusCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#fff",
    borderRadius: 18,
    overflow: "visible",
    marginTop: 28,
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
  },
  bonusHeader: {
    height: 92,
    backgroundColor: POPUP_HEADER,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  bonusBubble: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 999,
  },
  bonusBubbleLg: { width: 120, height: 120, left: -28, top: -18 },
  bonusBubbleMd: { width: 70, height: 70, left: 42, top: 28 },
  bonusBubbleSm: { width: 36, height: 36, left: 18, top: 8 },
  bonusCoinWrap: {
    position: "absolute",
    top: -28,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 4,
  },
  bonusCoin: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: POPUP_GOLD,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#F7E08A",
    elevation: 14,
  },
  bonusBody: {
    backgroundColor: "#fff",
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 8,
  },
  bonusText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#1A1A1A",
    fontWeight: "500",
  },
  bonusActions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    backgroundColor: "#fff",
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  bonusBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  bonusBtnCancel: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#DCC07A",
  },
  bonusBtnPrimary: { backgroundColor: POPUP_OK },
  bonusBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  bonusBtnCancelText: {
    color: "#3B2508",
    fontSize: 15,
    fontWeight: "700",
  },
});
