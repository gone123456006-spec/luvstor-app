import { Ionicons } from "@expo/vector-icons";
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
import { nativeAlert } from "../../components/AppAlert";
import BonusCoin from "../../components/BonusCoin";
import WhatsAppAvatar from "../../components/WhatsAppAvatar";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
} from "../../utils/auth";
import { claimDailySpin, fetchTokenBalance } from "../../utils/chatTokens";
import {
    fetchTokenPacks,
    initiateTokenPurchase,
    type TokenPackOffer,
} from "../../utils/payment";
import { getCachedProfile } from "../../utils/profileCache";
import {
    getCachedTokenBalance,
    preloadTokenBalance,
    setCachedTokenBalance,
    updateCachedTokenBalance,
} from "../../utils/tokenCache";
import { apiRequest } from "../../utils/api";
import { resolveMediaUrl } from "../../utils/media";

// ─────────────────────────────────────────────
// Wheel config
// ─────────────────────────────────────────────
const FREE_SPIN_CYCLE = [10, 10, 20, 10, 20, 10, 50];
// Minimalist segment palette — soft, clean, high-contrast pairs
const FESTIVAL_PALETTE = [
  { color: "#EF4444", textColor: "#FFFFFF" }, // soft red
  { color: "#F59E0B", textColor: "#FFFFFF" }, // amber
  { color: "#8B5CF6", textColor: "#FFFFFF" }, // violet
  { color: "#EC4899", textColor: "#FFFFFF" }, // pink
  { color: "#14B8A6", textColor: "#FFFFFF" }, // teal
  { color: "#3B82F6", textColor: "#FFFFFF" }, // blue
  { color: "#EAB308", textColor: "#1C1917" }, // gold (jackpot)
];
function segmentsFromCycle(cycle: number[]) {
  const jackpot = Math.max(...cycle, 0);
  let dayNum = 0;
  return cycle.map((tokens, i) => {
    const isJackpot = tokens === jackpot && tokens >= 50;
    if (!isJackpot) dayNum += 1;
    const pal = FESTIVAL_PALETTE[i % FESTIVAL_PALETTE.length];
    return {
      label: String(tokens),
      subLabel: isJackpot ? "JACKPOT" : `Day ${dayNum}`,
      tokens,
      color: isJackpot ? "#EAB308" : pal.color,
      textColor: isJackpot ? "#1C1917" : pal.textColor,
    };
  });
}

const { width: SCREEN_W } = Dimensions.get("window");
const WHEEL_SIZE = Math.min(SCREEN_W - 56, 280);
const TWO_PI = 2 * Math.PI;
const SCROLL_H_PAD = 20;
const AD_BANNER_H = 168;
const TOKEN_PACKS = [
  { id: "10", count: 10, price: "₹10", listPriceInr: 10 },
  { id: "100", count: 100, price: "₹80", listPriceInr: 80 },
  { id: "500", count: 500, price: "₹350", listPriceInr: 350 },
  { id: "1000", count: 1000, price: "₹600", listPriceInr: 600, popular: true },
  { id: "5000", count: 5000, price: "₹2,000", listPriceInr: 2000 },
  { id: "10000", count: 10000, price: "₹3,000", listPriceInr: 3000 },
  { id: "50000", count: 50000, price: "₹10,000", listPriceInr: 10000 },
  {
    id: "100000",
    count: 100000,
    price: "₹15,000",
    listPriceInr: 15000,
    biggest: true,
  },
] as const;

function formatInr(n: number) {
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

const POPUP_BG = "#E5D39A";
const POPUP_HEADER = "#E8D48A";
const POPUP_CANCEL = "#DCC07A";
const POPUP_OK = "#A67C1A";
const POPUP_GOLD = "#F4C430";

function msUntilNextSpin(nextSpinAt?: string | null, now = Date.now()) {
  if (!nextSpinAt) return 0;
  const t = Date.parse(nextSpinAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, t - now);
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
  nextSpinAt,
  onCancel,
  onPrimary,
}: {
  visible: boolean;
  variant: "wait" | "won";
  tokensWon?: number;
  nextSpinAt?: string | null;
  onCancel: () => void;
  onPrimary: () => void;
}) {
  const [remainMs, setRemainMs] = React.useState(() =>
    msUntilNextSpin(nextSpinAt),
  );

  React.useEffect(() => {
    if (!visible || variant !== "wait") return;
    setRemainMs(msUntilNextSpin(nextSpinAt));
    const t = setInterval(() => setRemainMs(msUntilNextSpin(nextSpinAt)), 1000);
    return () => clearInterval(t);
  }, [visible, variant, nextSpinAt]);

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
      <View style={styles.bonusWrap}>
        <View style={styles.bonusCoinWrap} pointerEvents="none">
          <BonusCoin />
        </View>
        <View style={styles.bonusCard}>
          <View style={styles.bonusHeader}>
            <View style={[styles.bonusBubble, styles.bonusBubbleLg]} />
            <View style={[styles.bonusBubble, styles.bonusBubbleSm]} />
            <View style={[styles.bonusBubble, styles.bonusBubbleMd]} />
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
    </View>
  );
}

function SunburstBg() {
  const rays = 24;
  return (
    <View style={styles.sunburstBg} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#E5D39A" }]} />
      {Array.from({ length: rays }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.sunburstRay,
            {
              transform: [{ rotate: `${(i * 360) / rays}deg` }],
              backgroundColor: i % 2 === 0 ? "#E8D48A" : "#DCC07A",
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Festival pie wheel — Views only (no SVG). */
function SpinWheelFace({
  segments,
  size,
}: {
  segments: ReturnType<typeof segmentsFromCycle>;
  size: number;
}) {
  const n = Math.max(segments.length, 1);
  const sliceDeg = 360 / n;
  const rim = 16;
  const inner = size - rim * 2;
  const radius = inner / 2;
  // Mid of colored band (between GO hub and outer rim)
  const hubR = 48;
  const labelR = (hubR + radius) * 0.5;
  // Keep number narrower than the wedge arc so it never spills into neighbors
  const wedgeArc = labelR * (sliceDeg * (Math.PI / 180));
  const labelW = Math.min(40, Math.max(28, wedgeArc * 0.55));
  const labelH = 34;

  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={[
          "#F0D56A",
          "#E8C547",
          "#A67C1A",
          "#F3D56A",
          "#7A5A12",
          "#D4B24A",
          "#5C440C",
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: size - 10,
            height: size - 10,
            borderRadius: (size - 10) / 2,
            backgroundColor: "#8A6A18",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LinearGradient
            colors={["#6B5010", "#E6C35A", "#E8C547"]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{
              width: size - 18,
              height: size - 18,
              borderRadius: (size - 18) / 2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: inner,
                height: inner,
                borderRadius: radius,
                overflow: "hidden",
                backgroundColor: "#1A1208",
              }}
            >
              {segments.map((seg, i) => {
                // Triangle is symmetric about local "up", so rotate to wedge MID
                // (matches spin math: mid at (i + 0.5) * slice)
                const midDeg = (i + 0.5) * sliceDeg;
                const halfBase =
                  Math.tan((sliceDeg / 2) * (Math.PI / 180)) * radius * 1.01;
                return (
                  <View
                    key={`slice-${i}`}
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      width: inner,
                      height: inner,
                      transform: [{ rotate: `${midDeg}deg` }],
                    }}
                  >
                    <View
                      style={{
                        position: "absolute",
                        left: radius - halfBase,
                        top: 0,
                        width: 0,
                        height: 0,
                        borderStyle: "solid",
                        borderLeftWidth: halfBase,
                        borderRightWidth: halfBase,
                        borderTopWidth: radius,
                        borderLeftColor: "transparent",
                        borderRightColor: "transparent",
                        borderTopColor: seg.color,
                      }}
                    />
                    {/* Number locked to this wedge's centerline — same midDeg */}
                    <View
                      style={{
                        position: "absolute",
                        left: radius - labelW / 2,
                        top: radius - labelR - labelH / 2,
                        width: labelW,
                        height: labelH,
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          color: seg.textColor,
                          fontSize: 22,
                          fontWeight: "900",
                          textAlign: "center",
                          includeFontPadding: false,
                          width: labelW,
                          textShadowColor:
                            seg.textColor === "#FFFFFF"
                              ? "rgba(0,0,0,0.45)"
                              : "rgba(255,255,255,0.35)",
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}
                      >
                        {seg.label}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </LinearGradient>
        </View>
      </LinearGradient>
    </View>
  );
}

// ─────────────────────────────────────────────
// SpinModal (1 free spin per 24h window from first spin)
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
  nextSpinAt?: string | null;
  onSpinAvailabilityChange: (
    canSpin: boolean,
    remaining?: number,
    nextSpinAt?: string | null,
  ) => void;
}

function SpinModal({
  visible,
  onClose,
  balance,
  onBalanceChange,
  canSpinToday: _canSpinToday,
  spinsRemaining,
  spinsPerDay,
  spinCycle: _spinCycle,
  nextSpinAt: nextSpinAtProp,
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
  const [nextSpinAt, setNextSpinAt] = React.useState<string | null>(
    nextSpinAtProp ?? null,
  );
  const insets = useSafeAreaInsets();
  const dotCount = Math.min(Math.max(spinsPerDay, 1), 8);

  React.useEffect(() => {
    setSpinsLeft(spinsRemaining);
  }, [spinsRemaining, visible]);

  React.useEffect(() => {
    setNextSpinAt(nextSpinAtProp ?? null);
  }, [nextSpinAtProp, visible]);

  React.useEffect(() => {
    if (!visible) {
      setWaitOpen(false);
      setResult(null);
      rotAnim.setValue(0);
      currentRot.current = 0;
      setIsSpinning(false);
    }
  }, [visible, rotAnim]);

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
        if (claim.nextSpinAt) setNextSpinAt(claim.nextSpinAt);
        onSpinAvailabilityChange(
          remaining > 0,
          remaining,
          claim.nextSpinAt ?? null,
        );
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
      if (claim.nextSpinAt) setNextSpinAt(claim.nextSpinAt);
      onSpinAvailabilityChange(
        remaining > 0,
        remaining,
        claim.nextSpinAt ?? null,
      );

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
        // Keep JS driver — LinearGradient slices can blank with native driver
        useNativeDriver: false,
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
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalDismiss}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalSheet}>
          <View
            style={[
              styles.modalSheetInner,
              { paddingBottom: Math.max(insets.bottom, 24) + 16 },
            ]}
          >
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
                }}
              >
                <SpinWheelFace segments={segments} size={WHEEL_SIZE} />
              </Animated.View>

              <View style={styles.goHub} pointerEvents="box-none">
                <View style={styles.goPointer} pointerEvents="none" />
                <TouchableOpacity
                  style={styles.wheelCenterBtn}
                  onPress={doSpin}
                  activeOpacity={0.85}
                  disabled={isSpinning}
                >
                  <LinearGradient
                    colors={["#F0D56A", "#D4A017", "#8A6A18", "#E8C547"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.goRing}
                  >
                    <View style={styles.goInner}>
                      <Text style={styles.wheelCenterText}>
                        {isSpinning ? "…" : "GO!"}
                      </Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <SpinBonusPopup
          visible={waitOpen}
          variant="wait"
          nextSpinAt={nextSpinAt}
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
      <LinearGradient
        colors={["#1B0B2E", "#3D1A6B", "#5A2FC7", "#2A1050"]}
        locations={[0, 0.35, 0.72, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      {/* Soft light wash — banner depth without photos */}
      <LinearGradient
        colors={[
          "rgba(255, 209, 102, 0.22)",
          "rgba(255, 209, 102, 0.04)",
          "transparent",
        ]}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.adSheen}
        pointerEvents="none"
      />
      <View style={styles.adOrbLarge} pointerEvents="none" />
      <View style={styles.adOrbSmall} pointerEvents="none" />
      <View style={styles.adGoldEdge} pointerEvents="none" />

      <View style={styles.adCopy} pointerEvents="none">
        <View style={styles.adKickerRow}>
          <Ionicons name="diamond" size={12} color="#FFD166" />
          <Text style={styles.adKicker}>Luvstor Premium</Text>
        </View>
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
  const buyButtonY = React.useRef(0);
  const initialSnapshot = React.useMemo(() => getCachedTokenBalance(), []);

  const scrollToTokenPacks = React.useCallback(() => {
    scrollRef.current?.scrollTo({
      y: Math.max(tokenSectionY.current - 8, 0),
      animated: true,
    });
  }, []);

  const scrollToBuyButton = React.useCallback(() => {
    const y = tokenSectionY.current + buyButtonY.current - 24;
    scrollRef.current?.scrollTo({
      y: Math.max(y, 0),
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
  const [nextSpinAt, setNextSpinAt] = React.useState<string | null>(
    (initialSnapshot as { nextSpinAt?: string | null } | null)?.nextSpinAt ??
      null,
  );
  const [loadingBalance, setLoadingBalance] = React.useState(!initialSnapshot);
  const [spinModalOpen, setSpinModalOpen] = React.useState(false);
  const [selectedPackId, setSelectedPackId] = React.useState<string>("1000");
  const [buying, setBuying] = React.useState(false);
  const [buyBtnPulse, setBuyBtnPulse] = React.useState(false);
  const [packOffers, setPackOffers] = React.useState<
    Record<string, TokenPackOffer>
  >({});
  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(null);
  const [userName, setUserName] = React.useState<string>("");
  const [userEmail, setUserEmail] = React.useState<string>("");
  const [userPublicId, setUserPublicId] = React.useState<string>("");
  const [spinCycle, setSpinCycle] = React.useState<number[]>(FREE_SPIN_CYCLE);

  const applyBalanceData = React.useCallback(
    (data: Awaited<ReturnType<typeof fetchTokenBalance>>) => {
      setBalance(data.tokenBalance ?? 0);
      setCanSpinToday(!!data.canSpinToday);
      setSpinsRemaining(data.spinsRemaining ?? (data.canSpinToday ? 1 : 0));
      setSpinsPerDay(data.spinsPerDay ?? 1);
      setNextSpinAt(data.nextSpinAt ?? null);
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
        try {
          const { packs } = await fetchTokenPacks(token);
          const map: Record<string, TokenPackOffer> = {};
          for (const p of packs) map[p.id] = p;
          setPackOffers(map);
        } catch {
          /* keep static pack prices */
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

  const selectedPack = React.useMemo(
    () => TOKEN_PACKS.find((p) => p.id === selectedPackId) ?? TOKEN_PACKS[0],
    [selectedPackId],
  );

  const selectedPackPriceLabel = React.useMemo(() => {
    const offer = packOffers[selectedPack.id];
    const priceInr =
      offer?.priceInr ??
      ("listPriceInr" in selectedPack ? selectedPack.listPriceInr : undefined);
    return priceInr != null ? formatInr(priceInr) : selectedPack.price;
  }, [packOffers, selectedPack]);

  const selectPackAndShowBuy = React.useCallback(
    (packId: string) => {
      setSelectedPackId(packId);
      setBuyBtnPulse(true);
      // Let layout settle, then scroll Buy Tokens into view
      requestAnimationFrame(() => {
        setTimeout(() => scrollToBuyButton(), 50);
      });
      setTimeout(() => setBuyBtnPulse(false), 1200);
    },
    [scrollToBuyButton],
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

      const added = result.credited ?? pack.count;
      const bonus = result.bonusTokens || 0;
      Alert.alert(
        "Payment Successful",
        bonus > 0
          ? `${added.toLocaleString()} tokens added, including +${bonus.toLocaleString()} subscriber bonus.`
          : `${added.toLocaleString()} tokens have been added to your balance.`,
        [{ text: "OK" }],
      );

      // Reload balance + refreshed pack-10 offer price
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
          setUserEmail(authUser.email || "");

          const snap = getCachedProfile();
          const parsed = await getLocalProfile(authUser.email);

          let photo =
            snap?.profile?.photo ||
            (Array.isArray(snap?.profile?.photos) && snap.profile.photos[0]) ||
            parsed?.photo ||
            (Array.isArray(parsed?.photos) && parsed.photos[0]) ||
            "";
          let name = snap?.profile?.name || parsed?.name || "";
          let publicId = snap?.profile?.publicId || parsed?.publicId || "";

          try {
            const token = await getAuthToken();
            if (token) {
              const me: any = await apiRequest("/api/users/me", token);
              if (me?.photo) photo = String(me.photo);
              else if (Array.isArray(me?.photos) && me.photos[0]) {
                photo = String(me.photos[0]);
              }
              if (me?.name) name = String(me.name);
              if (me?.publicId) publicId = String(me.publicId);
            }
          } catch {
            /* keep local / cache */
          }

          setProfilePhoto(resolveMediaUrl(String(photo)) || String(photo) || null);
          setUserName(String(name || ""));
          setUserPublicId(String(publicId || ""));
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
              <WhatsAppAvatar
                photo={profilePhoto}
                name={userName || "You"}
                publicId={userPublicId || undefined}
                size={34}
              />
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
                const offer = packOffers[pack.id];
                const priceInr =
                  offer?.priceInr ??
                  ("listPriceInr" in pack ? pack.listPriceInr : undefined);
                const listPriceInr =
                  offer?.listPriceInr ??
                  ("listPriceInr" in pack ? pack.listPriceInr : undefined);
                const showStrike =
                  !!priceInr && !!listPriceInr && priceInr < listPriceInr;
                const priceLabel =
                  priceInr != null ? formatInr(priceInr) : pack.price;
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
                    onPress={() => selectPackAndShowBuy(pack.id)}
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
                        {offer?.offerLabel ? (
                          <View style={styles.planOfferTag}>
                            <Text style={styles.planOfferText}>
                              {offer.offerLabel}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.planPriceCol}>
                      {showStrike ? (
                        <Text style={styles.planPriceStrike}>
                          {formatInr(listPriceInr!)}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.planPrice,
                          selected && styles.planPriceSelected,
                        ]}
                      >
                        {priceLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              onLayout={(e) => {
                buyButtonY.current = e.nativeEvent.layout.y;
              }}
              style={[
                styles.continueBtn,
                buyBtnPulse && styles.continueBtnPulse,
                buying && styles.continueBtnDisabled,
              ]}
              activeOpacity={0.85}
              disabled={buying}
              onPress={buySelectedPack}
            >
              <Text style={styles.continueBtnText}>
                {buying
                  ? "Processing…"
                  : `Buy ${selectedPack.count.toLocaleString()} tokens · ${selectedPackPriceLabel}`}
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
        nextSpinAt={nextSpinAt}
        onSpinAvailabilityChange={(canSpin, remaining, nextAt) => {
          setCanSpinToday(canSpin);
          if (remaining !== undefined) setSpinsRemaining(remaining);
          if (nextAt !== undefined) setNextSpinAt(nextAt);
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
    backgroundColor: "#F5F5F7",
  },
  page: {
    flex: 1,
    backgroundColor: "#F5F5F7",
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
    alignItems: "center",
    justifyContent: "center",
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
    backgroundColor: "#1B0B2E",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 209, 102, 0.35)",
  },
  adSheen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  adOrbLarge: {
    position: "absolute",
    right: -40,
    top: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(255, 209, 102, 0.12)",
    zIndex: 1,
  },
  adOrbSmall: {
    position: "absolute",
    right: 48,
    bottom: -36,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(142, 45, 226, 0.35)",
    zIndex: 1,
  },
  adGoldEdge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: "#FFD166",
    zIndex: 2,
  },
  adCopy: {
    position: "absolute",
    left: 20,
    right: 16,
    bottom: 14,
    top: 14,
    justifyContent: "flex-end",
    zIndex: 3,
  },
  adKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  adKicker: {
    color: "#FFD166",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  adTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  adSub: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 4,
    marginBottom: 12,
  },
  adCta: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFD166",
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 22,
    ...Platform.select({
      ios: {
        shadowColor: "#FFD166",
        shadowOpacity: 0.35,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
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
  planOfferTag: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planOfferText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2E7D32",
  },
  planPriceCol: {
    alignItems: "flex-end",
    marginLeft: 8,
  },
  planPriceStrike: {
    fontSize: 12,
    color: "#9CA3AF",
    textDecorationLine: "line-through",
    marginBottom: 1,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
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
  continueBtnPulse: {
    transform: [{ scale: 1.02 }],
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
    backgroundColor: "#E5D39A",
    maxHeight: "88%",
  },
  modalSheetInner: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#E5D39A",
    minHeight: WHEEL_SIZE + 110,
  },
  sunburstBg: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
    overflow: "hidden",
  },
  sunburstRay: {
    position: "absolute",
    width: 56,
    height: 720,
    left: "50%",
    top: "50%",
    marginLeft: -28,
    marginTop: -360,
  },
  modalHeader: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    zIndex: 2,
  },
  modalTitleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  modalKicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    color: "#A67C1A",
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#5C2E00",
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
    justifyContent: "center",
    marginBottom: 10,
    gap: 6,
    zIndex: 2,
  },
  dotsLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7A3E00",
    marginRight: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#E07A14",
    marginHorizontal: 2,
  },
  dotUsed: { backgroundColor: "rgba(122, 62, 0, 0.28)" },

  wheelWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    marginTop: 4,
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    zIndex: 2,
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
    marginTop: -58,
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 18,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#6C2BD9",
    zIndex: 14,
  },
  wheelCenterBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
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
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  goInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#5B21B6",
    borderWidth: 1.5,
    borderColor: "rgba(255, 243, 196, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  wheelCenterText: {
    color: "#FFE566",
    fontSize: 22,
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
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 28,
    zIndex: 40,
  },
  bonusWrap: {
    width: "100%",
    maxWidth: 340,
    paddingTop: 30,
  },
  bonusCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 18,
    overflow: "visible",
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
  },
  bonusHeader: {
    height: 58,
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
  bonusBubbleLg: { width: 90, height: 90, left: -22, top: -28 },
  bonusBubbleMd: { width: 52, height: 52, left: 34, top: 12 },
  bonusBubbleSm: { width: 26, height: 26, left: 12, top: 2 },
  bonusCoinWrap: {
    position: "absolute",
    top: 0,
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
    paddingTop: 16,
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
