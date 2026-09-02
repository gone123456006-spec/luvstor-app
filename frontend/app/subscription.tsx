import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React from "react";
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
    Defs,
    Path,
    Stop,
    LinearGradient as SvgLinearGradient,
} from "react-native-svg";
import {
    getAuthToken,
    getCurrentAuthUser,
    getLocalProfile,
} from "../utils/auth";
import {
    BillingPeriod,
    BillingPeriodId,
    fetchSubscriptionPlans,
    fetchSubscriptionStatus,
    formatExpiry,
    initiateSubscriptionPurchase,
    planBadgeColor,
    PlanPricing,
    SubscriptionPlan,
    SubscriptionPlanId,
    SubscriptionStatus,
} from "../utils/subscriptions";

const PAGE = {
  bg: "#000000",
  surface: "#1C1C1E",
  surfaceAlt: "#2C2C2E",
  text: "#FFFFFF",
  secondary: "#8E8E93",
  border: "#3A3A3C",
};

const WA = {
  bg: PAGE.bg,
  white: PAGE.surface,
  text: PAGE.text,
  secondary: PAGE.secondary,
  border: PAGE.border,
  teal: "#128C7E",
  header: PAGE.bg,
  rowDivider: PAGE.surfaceAlt,
};

/** Luvstor — buttons only */
const BTN = {
  primary: "#6750A4",
  primaryLight: "#EADDFF",
};

const PLAN_ORDER: SubscriptionPlanId[] = ["free", "gold", "platinum", "black"];
const CARD_GAP = 12;
const CARD_WIDTH = Dimensions.get("window").width * 0.78;
const CARD_HEIGHT = 430;

const PERIOD_MONTHS: Record<BillingPeriodId, number> = {
  monthly: 1,
  quarterly: 3,
  "6months": 6,
  annual: 12,
};

function getPeriodSavePercent(
  pricing: PlanPricing | undefined,
  periodId: BillingPeriodId,
): number {
  if (!pricing || periodId === "monthly") return 0;
  const monthly = pricing.monthly;
  const months = PERIOD_MONTHS[periodId];
  const price = pricing[periodId];
  if (!monthly || !months || price == null) return 0;
  const fullPrice = monthly * months;
  if (fullPrice <= 0) return 0;
  return Math.max(0, Math.round((1 - price / fullPrice) * 100));
}

function SaveBadge({ active, savePct }: { active: boolean; savePct: number }) {
  return (
    <View style={styles.saveBadgeWrap} pointerEvents="none">
      <View style={[styles.saveBadge, active && styles.saveBadgeActive]}>
        <Text
          style={[styles.saveBadgeText, active && styles.saveBadgeTextActive]}
        >
          SAVE {savePct}%
        </Text>
      </View>
      <View
        style={[
          styles.saveBadgePointer,
          active && styles.saveBadgePointerActive,
        ]}
      />
    </View>
  );
}

function BillingPeriodBar({
  periods,
  selected,
  onSelect,
  pricing,
}: {
  periods: BillingPeriod[];
  selected: BillingPeriodId;
  onSelect: (id: BillingPeriodId) => void;
  pricing?: PlanPricing;
}) {
  return (
    <View style={styles.periodTrack}>
      {periods.map((period, index) => {
        const active = selected === period.id;
        const savePct = getPeriodSavePercent(pricing, period.id);
        const isFirst = index === 0;
        const isLast = index === periods.length - 1;

        return (
          <TouchableOpacity
            key={period.id}
            style={[
              styles.periodSegment,
              !isFirst && styles.periodSegmentBorder,
            ]}
            activeOpacity={0.88}
            onPress={() => onSelect(period.id)}
          >
            <SaveBadge active={active} savePct={savePct} />
            {active ? (
              <LinearGradient
                colors={["#F7D774", "#E8B923", "#CF9510"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[
                  styles.periodActiveBtn,
                  isFirst && styles.periodCellFirst,
                  isLast && styles.periodCellLast,
                ]}
              >
                <Text style={styles.periodActiveText} numberOfLines={1}>
                  {period.label}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.periodIdleBtn}>
                <Text style={styles.periodIdleText} numberOfLines={1}>
                  {period.label}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type PlanCardTheme = {
  bg: [string, string, ...string[]];
  bgLocations: number[];
  shine: [string, string, ...string[]];
  rim: [string, string, ...string[]];
  frame: [string, string, ...string[]];
  border: string;
  title: string;
  price: string;
  period: string;
  feature: string;
  divider: string;
  checkBg: string;
  checkIcon: string;
  featureIcon: string;
  button: [string, string, ...string[]];
  buttonText: string;
  popularBg: [string, string, ...string[]];
  popularText: string;
  popular?: boolean;
  darkMetal?: boolean;
};

const PLAN_CARD: Record<"free" | "gold" | "platinum" | "black", PlanCardTheme> =
  {
    free: {
      bg: [
        "#F5F0FF",
        "#EADDFF",
        "#D0BCFF",
        "#E8DEF8",
        "#B69DF8",
        "#D5C6F5",
        "#C9B6F0",
        "#EDE7F6",
      ],
      bgLocations: [0, 0.12, 0.28, 0.42, 0.58, 0.72, 0.88, 1],
      shine: [
        "rgba(255,255,255,0.8)",
        "rgba(255,255,255,0.22)",
        "rgba(255,255,255,0)",
        "rgba(255,255,255,0.35)",
        "rgba(255,255,255,0.1)",
      ],
      rim: [
        "rgba(255,255,255,0.6)",
        "rgba(255,255,255,0)",
        "rgba(60,40,100,0.22)",
      ],
      frame: ["#FFFFFF", "#EADDFF", "#6750A4", "#D0BCFF", "#B69DF8"],
      border: "#6750A4",
      title: "#381E72",
      price: "#1C1B1F",
      period: "rgba(28,27,31,0.6)",
      feature: "#1C1B1F",
      divider: "rgba(103,80,164,0.22)",
      checkBg: "#6750A4",
      checkIcon: "#EADDFF",
      featureIcon: "#4F378B",
      button: ["#7F67BE", "#6750A4", "#4F378B", "#7965AF"],
      buttonText: "#FFFFFF",
      popularBg: ["#6750A4", "#4F378B"],
      popularText: "#EADDFF",
    },
    gold: {
      bg: [
        "#FFF8D6",
        "#F5E08A",
        "#E8C547",
        "#B8860B",
        "#D4AF37",
        "#8B6914",
        "#F0D060",
        "#C9A227",
      ],
      bgLocations: [0, 0.12, 0.28, 0.42, 0.58, 0.72, 0.88, 1],
      shine: [
        "rgba(255,255,255,0.75)",
        "rgba(255,255,255,0.2)",
        "rgba(255,255,255,0)",
        "rgba(255,248,200,0.35)",
        "rgba(255,255,255,0.08)",
      ],
      rim: [
        "rgba(255,255,255,0.55)",
        "rgba(255,255,255,0)",
        "rgba(80,50,0,0.35)",
      ],
      frame: ["#FFF1A8", "#D4AF37", "#8B6914", "#E8C547", "#A67C00"],
      border: "#8B6914",
      title: "#2E2000",
      price: "#1A1200",
      period: "rgba(26,18,0,0.62)",
      feature: "#241800",
      divider: "rgba(90,60,0,0.22)",
      checkBg: "#4A3400",
      checkIcon: "#FFE9A0",
      featureIcon: "#5C4300",
      button: ["#6B4E09", "#3D2A00", "#1A1200", "#4A3400"],
      buttonText: "#FFE9A0",
      popularBg: ["#3D2A00", "#1A1200"],
      popularText: "#FFE9A0",
      popular: true,
    },
    platinum: {
      bg: [
        "#FFFFFF",
        "#F2F5F8",
        "#C5CED6",
        "#E8EEF2",
        "#8E9BA8",
        "#DDE4EA",
        "#A8B4C0",
        "#F7F9FB",
      ],
      bgLocations: [0, 0.12, 0.28, 0.42, 0.58, 0.72, 0.88, 1],
      shine: [
        "rgba(255,255,255,0.85)",
        "rgba(255,255,255,0.25)",
        "rgba(255,255,255,0)",
        "rgba(255,255,255,0.4)",
        "rgba(255,255,255,0.1)",
      ],
      rim: [
        "rgba(255,255,255,0.65)",
        "rgba(255,255,255,0)",
        "rgba(40,50,60,0.28)",
      ],
      frame: ["#FFFFFF", "#C5CED6", "#7A8A96", "#E8EEF2", "#9AA8B4"],
      border: "#6E7E8A",
      title: "#152028",
      price: "#0A0F14",
      period: "rgba(10,15,20,0.58)",
      feature: "#152028",
      divider: "rgba(70,85,98,0.24)",
      checkBg: "#24323C",
      checkIcon: "#F4F7F9",
      featureIcon: "#3A4854",
      button: ["#3A4854", "#1A242C", "#0A1016", "#2C3844"],
      buttonText: "#F4F7F9",
      popularBg: ["#2C3844", "#0F161C"],
      popularText: "#F4F7F9",
    },
    black: {
      bg: [
        "#5A5A5A",
        "#2A2A2A",
        "#0A0A0A",
        "#3D3D3D",
        "#050505",
        "#1F1F1F",
        "#4A4A4A",
        "#121212",
      ],
      bgLocations: [0, 0.14, 0.3, 0.46, 0.62, 0.76, 0.9, 1],
      shine: [
        "rgba(255,255,255,0.38)",
        "rgba(255,255,255,0.1)",
        "rgba(255,255,255,0)",
        "rgba(255,255,255,0.18)",
        "rgba(255,255,255,0.04)",
      ],
      rim: [
        "rgba(255,255,255,0.28)",
        "rgba(255,255,255,0)",
        "rgba(0,0,0,0.45)",
      ],
      frame: ["#C8C8C8", "#6A6A6A", "#2A2A2A", "#8A8A8A", "#3A3A3A"],
      border: "#9A9A9A",
      title: "#FFFFFF",
      price: "#FFFFFF",
      period: "rgba(255,255,255,0.7)",
      feature: "#F2F2F2",
      divider: "rgba(255,255,255,0.12)",
      checkBg: "#EDEDED",
      checkIcon: "#111111",
      featureIcon: "#C8C8C8",
      button: ["#FFFFFF", "#D8D8D8", "#A8A8A8", "#E8E8E8"],
      buttonText: "#111111",
      popularBg: ["#F5F5F5", "#B8B8B8"],
      popularText: "#111111",
      darkMetal: true,
    },
  };

const FEATURE_ICONS: Record<
  string,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  chatSession: "time-outline",
  monthlyTokens: "wallet-outline",
  tokenBonus: "pricetag-outline",
  dailySpin: "sync-outline",
  discoverBoost: "compass-outline",
  topSpotDaily: "star-outline",
  calls: "mic-outline",
  badge: "shield-checkmark-outline",
};

function getPlanCardTheme(id: SubscriptionPlanId): PlanCardTheme | null {
  if (id === "free" || id === "gold" || id === "platinum" || id === "black") {
    return PLAN_CARD[id];
  }
  return null;
}

const POPULAR_TAG_W = 128;
const POPULAR_TAG_H = 26;

function PopularRibbon() {
  // Classic tag: pointed left tip + rounded right, flush top-right
  const w = POPULAR_TAG_W;
  const h = POPULAR_TAG_H;
  const tip = 12;
  const r = 14;
  const d = [
    `M ${tip} 0`,
    `L ${w - r} 0`,
    `Q ${w} 0 ${w} ${r}`,
    `L ${w} ${h}`,
    `L ${tip} ${h}`,
    `L 0 ${h / 2}`,
    "Z",
  ].join(" ");

  return (
    <View style={styles.popularRibbonWrap} pointerEvents="none">
      <Svg width={w} height={h} style={styles.popularRibbonSvg}>
        <Defs>
          <SvgLinearGradient id="popularGold" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF8D6" />
            <Stop offset="0.3" stopColor="#F0D060" />
            <Stop offset="0.65" stopColor="#D4A017" />
            <Stop offset="1" stopColor="#A67C00" />
          </SvgLinearGradient>
          <SvgLinearGradient id="popularShine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0.05" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.35" />
          </SvgLinearGradient>
        </Defs>
        <Path d={d} fill="url(#popularGold)" />
        <Path d={d} fill="url(#popularShine)" />
        {/* Tag hole */}
        <Path
          d={`M ${tip - 1} ${h / 2 - 3.2} a 3.2 3.2 0 1 1 0 6.4 a 3.2 3.2 0 1 1 0 -6.4`}
          fill="#1A1200"
          fillOpacity={0.55}
        />
      </Svg>
      <Text style={styles.popularRibbonText}>MOST POPULAR</Text>
    </View>
  );
}

function PlanBadge({
  label,
  plan,
}: {
  label: string;
  plan?: SubscriptionPlanId;
}) {
  if (plan) {
    const color = planBadgeColor(plan);
    return (
      <View style={[styles.planBadge, { backgroundColor: `${color}44` }]}>
        <Ionicons name="diamond" size={13} color={color} />
        <Text style={[styles.planBadgeText, { color: PAGE.text }]}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.planBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}
    >
      <Ionicons name="diamond" size={13} color={PAGE.text} />
      <Text style={[styles.planBadgeText, { color: PAGE.text }]}>{label}</Text>
    </View>
  );
}

function formatInr(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [buying, setBuying] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SubscriptionStatus | null>(null);
  const [plans, setPlans] = React.useState<SubscriptionPlan[]>([]);
  const [billingPeriods, setBillingPeriods] = React.useState<BillingPeriod[]>(
    [],
  );
  const [selectedPeriod, setSelectedPeriod] =
    React.useState<BillingPeriodId>("monthly");
  const [focusedPlanId, setFocusedPlanId] =
    React.useState<SubscriptionPlanId>("free");
  const [userName, setUserName] = React.useState("");
  const [userEmail, setUserEmail] = React.useState("");

  const activePeriod =
    billingPeriods.find((p) => p.id === selectedPeriod) ??
    billingPeriods[0] ??
    null;

  const focusedPricing = React.useMemo(() => {
    const plan =
      plans.find((p) => p.id === focusedPlanId) ??
      plans.find((p) => p.id === "gold") ??
      plans.find((p) => p.id === "free");
    return plan?.pricing;
  }, [plans, focusedPlanId]);

  function updateFocusedPlanFromScroll(offsetX: number) {
    const index = Math.round(offsetX / (CARD_WIDTH + CARD_GAP));
    const id =
      PLAN_ORDER[Math.min(Math.max(index, 0), PLAN_ORDER.length - 1)] ?? "free";
    setFocusedPlanId(id);
  }

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      let planData: Awaited<ReturnType<typeof fetchSubscriptionPlans>> | null =
        null;
      let lastErr: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const [plansRes, sub] = await Promise.all([
            fetchSubscriptionPlans(),
            token ? fetchSubscriptionStatus(token) : Promise.resolve(null),
          ]);
          planData = plansRes;
          if (sub) setStatus(sub);
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e?.message || "Could not load subscription plans.";
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }
      if (!planData) {
        Alert.alert("Error", lastErr || "Could not load subscription plans.");
        return;
      }
      setPlans(planData.plans);
      setBillingPeriods(planData.billingPeriods);
      setSelectedPeriod(planData.defaultPeriodId);

      if (token) {
        const authUser = await getCurrentAuthUser();
        const profile = await getLocalProfile(authUser?.email);
        if (profile?.name) setUserName(profile.name);
        if (authUser?.email) setUserEmail(authUser.email);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  async function handleSubscribe(planId: SubscriptionPlanId) {
    if (buying) return;
    const plan = plans.find((p) => p.id === planId);
    if (!plan || planId === "free") return;

    const isRenew =
      status?.isActive && status.plan === planId;

    setBuying(planId);
    try {
      const token = await getAuthToken();
      if (!token) {
        Alert.alert("Sign in required", "Please log in to subscribe.");
        return;
      }

      const result = await initiateSubscriptionPurchase(
        token,
        planId,
        selectedPeriod,
        userName,
        userEmail,
      );

      if (!result.success) {
        if (result.error !== "Payment cancelled") {
          Alert.alert("Subscription failed", result.error || "Try again");
        }
        return;
      }

      if (result.subscription) setStatus(result.subscription);
      const credited = result.subscription?.tokensCredited ?? 0;
      const periodLabel = activePeriod?.label.toLowerCase() ?? "plan";
      Alert.alert(
        isRenew ? "Renewed!" : "Welcome!",
        credited > 0
          ? `${plan.name} is active (${periodLabel}). ${credited.toLocaleString()} tokens were added to your wallet.`
          : `${plan.name} is now active (${periodLabel}).`,
      );
    } finally {
      setBuying(null);
    }
  }

  const activePlan = status?.isActive ? status.plan : "free";
  const showCurrentPlan = status?.isActive && activePlan !== "free";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={PAGE.bg} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={PAGE.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={BTN.primary} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {showCurrentPlan ? (
            <View style={styles.currentCard}>
              <View style={styles.currentTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentLabel}>Your plan</Text>
                  <Text style={styles.currentPlan}>{status?.planName}</Text>
                  {status?.expiresAt ? (
                    <Text style={styles.currentExpiry}>
                      Renews / expires {formatExpiry(status.expiresAt)}
                    </Text>
                  ) : null}
                </View>
                {status?.badge ? (
                  <PlanBadge plan={status.plan} label={status.planName} />
                ) : null}
              </View>
              <View style={styles.perksRow}>
                <View style={styles.perkChip}>
                  <Ionicons
                    name="chatbubbles"
                    size={14}
                    color={BTN.primaryLight}
                  />
                  <Text style={styles.perkText}>
                    {status?.unlimitedChat
                      ? "Unlimited chat"
                      : `${status?.chatSessionHours ?? 2}h session`}
                  </Text>
                </View>
                <View style={styles.perkChip}>
                  <Ionicons name="wallet" size={14} color={BTN.primaryLight} />
                  <Text style={styles.perkText}>
                    {(status?.monthlyTokenGrant ?? 0) > 0
                      ? `${status!.monthlyTokenGrant!.toLocaleString()} tokens`
                      : "—"}
                  </Text>
                </View>
                <View style={styles.perkChip}>
                  <Ionicons name="gift" size={14} color={BTN.primaryLight} />
                  <Text style={styles.perkText}>
                    {(status?.tokenBonusPercent ?? 0) > 0
                      ? `+${status?.tokenBonusPercent}% bonus`
                      : "—"}
                  </Text>
                </View>
                <View style={styles.perkChip}>
                  <Ionicons name="sync" size={14} color={BTN.primaryLight} />
                  <Text style={styles.perkText}>
                    {status?.spinsPerDay ?? 1} spin/day
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <Text
            style={[
              styles.sectionHint,
              !showCurrentPlan && styles.sectionHintFirst,
            ]}
          >
            Billing period
          </Text>
          <View style={styles.periodShell}>
            <BillingPeriodBar
              periods={billingPeriods}
              selected={selectedPeriod}
              onSelect={setSelectedPeriod}
              pricing={focusedPricing}
            />
          </View>

          <View style={styles.choosePlanHint}>
            <Ionicons name="diamond" size={12} color="#C9A227" />
            <Text style={[styles.sectionHint, styles.choosePlanHintText]}>
              Choose a plan
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={CARD_WIDTH + CARD_GAP}
            snapToAlignment="start"
            contentContainerStyle={styles.planCardsRow}
            onMomentumScrollEnd={(e) =>
              updateFocusedPlanFromScroll(e.nativeEvent.contentOffset.x)
            }
            onScrollEndDrag={(e) =>
              updateFocusedPlanFromScroll(e.nativeEvent.contentOffset.x)
            }
          >
            {PLAN_ORDER.map((id) => {
              const plan = plans.find((p) => p.id === id);
              if (!plan) return null;
              const isCurrent = activePlan === id;
              const price = plan.pricing[selectedPeriod];
              const theme = getPlanCardTheme(id)!;
              const featureEntries = (
                Object.entries(plan.features) as [string, string | null][]
              ).filter(([, line]) => Boolean(line));

              return (
                <View
                  key={id}
                  style={[
                    styles.planCardShell,
                    {
                      width: CARD_WIDTH,
                      height: CARD_HEIGHT,
                      shadowColor: theme.border,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={theme.bg}
                    locations={theme.bgLocations}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.planCard}
                  >
                    <LinearGradient
                      colors={theme.shine}
                      locations={[0, 0.18, 0.42, 0.68, 1]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.planCardShine}
                      pointerEvents="none"
                    />
                    <LinearGradient
                      colors={theme.rim}
                      locations={[0, 0.4, 1]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={styles.planCardSheen}
                      pointerEvents="none"
                    />
                    <LinearGradient
                      colors={[
                        "rgba(255,255,255,0)",
                        "rgba(255,255,255,0.45)",
                        "rgba(255,255,255,0)",
                      ]}
                      locations={[0.2, 0.5, 0.8]}
                      start={{ x: 0, y: 0.2 }}
                      end={{ x: 1, y: 0.8 }}
                      style={styles.planCardSpecular}
                      pointerEvents="none"
                    />

                    {theme.popular ? <PopularRibbon /> : null}

                    <View style={styles.planCardContent}>
                      <View style={styles.planHeader}>
                        <View style={styles.planTitleRow}>
                          <Ionicons
                            name="diamond"
                            size={15}
                            color={theme.title}
                          />
                          <Text
                            style={[styles.planName, { color: theme.title }]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.8}
                          >
                            {plan.name}
                          </Text>
                          {isCurrent ? (
                            <View
                              style={[
                                styles.activePill,
                                theme.darkMetal
                                  ? styles.activePillOnDark
                                  : styles.activePillOnLight,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.activePillText,
                                  {
                                    color: theme.darkMetal
                                      ? "#FFFFFF"
                                      : "#1A1200",
                                  },
                                ]}
                              >
                                Active
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text
                          style={[styles.planPrice, { color: theme.price }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.75}
                        >
                          {id === "free" ? (
                            <>
                              Free
                              <Text
                                style={[
                                  styles.planPeriod,
                                  { color: theme.period },
                                ]}
                              >
                                {" "}
                                / forever
                              </Text>
                            </>
                          ) : (
                            <>
                              {formatInr(price)}
                              <Text
                                style={[
                                  styles.planPeriod,
                                  { color: theme.period },
                                ]}
                              >
                                {" "}
                                /{" "}
                                {activePeriod?.label.toLowerCase() ?? "period"}
                              </Text>
                            </>
                          )}
                        </Text>
                      </View>

                      <View style={styles.featureList}>
                        {featureEntries.map(([key, line], index) => (
                          <View
                            key={key}
                            style={[
                              styles.featureRow,
                              index < featureEntries.length - 1 && {
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: theme.divider,
                              },
                            ]}
                          >
                            <View
                              style={[
                                styles.featureCheck,
                                { backgroundColor: theme.checkBg },
                              ]}
                            >
                              <Ionicons
                                name="checkmark"
                                size={10}
                                color={theme.checkIcon}
                              />
                            </View>
                            <Text
                              style={[
                                styles.featureText,
                                { color: theme.feature },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
                            >
                              {line as string}
                            </Text>
                            <Ionicons
                              name={FEATURE_ICONS[key] ?? "ellipse-outline"}
                              size={14}
                              color={theme.featureIcon}
                            />
                          </View>
                        ))}
                      </View>

                      <TouchableOpacity
                        activeOpacity={0.85}
                        disabled={id === "free" || !!buying}
                        onPress={() => handleSubscribe(id)}
                        style={[
                          styles.subscribeBtnWrap,
                          (id === "free" || buying === id) &&
                            styles.subscribeBtnDisabled,
                        ]}
                      >
                        <LinearGradient
                          colors={theme.button}
                          start={{ x: 0.5, y: 0 }}
                          end={{ x: 0.5, y: 1 }}
                          style={styles.subscribeBtn}
                        >
                          {buying === id ? (
                            <ActivityIndicator color={theme.buttonText} />
                          ) : (
                            <>
                              <Text
                                style={[
                                  styles.subscribeBtnText,
                                  { color: theme.buttonText },
                                ]}
                                numberOfLines={1}
                              >
                                {id === "free"
                                  ? isCurrent
                                    ? "Current plan"
                                    : "Always free"
                                  : isCurrent
                                    ? "Extend plan"
                                    : `Get ${plan.name}`}
                              </Text>
                              {id !== "free" ? (
                                <Ionicons
                                  name="arrow-forward"
                                  size={16}
                                  color={theme.buttonText}
                                />
                              ) : null}
                            </>
                          )}
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.trustRow}>
            <View style={styles.trustIconWrap}>
              <Ionicons name="shield-checkmark" size={14} color="#A8B0B8" />
            </View>
            <Text style={styles.trustText}>Secure payments • 100% safe</Text>
          </View>

          <TouchableOpacity
            style={styles.termsLink}
            activeOpacity={0.7}
            onPress={() => router.push("/subscription-terms" as any)}
          >
            <Text style={styles.termsLinkText}>
              Premium Subscription Terms and Conditions
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            * Black unlimited spins: fair-use cap of 500 spin tokens per day.
            Voice & video calls are available with friends only on all plans.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: PAGE.bg,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: PAGE.text,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingBottom: 40 },
  sectionHint: {
    fontSize: 13,
    color: PAGE.secondary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionHintFirst: {
    paddingTop: 16,
  },
  choosePlanHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  choosePlanHintText: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    color: "#C9A227",
  },
  periodShell: {
    marginHorizontal: 16,
    marginBottom: 2,
    paddingTop: 12,
  },
  periodTrack: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 32,
    overflow: "visible",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 10,
  },
  periodSegment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
    overflow: "visible",
    position: "relative",
  },
  periodSegmentBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "rgba(255,255,255,0.14)",
  },
  saveBadgeWrap: {
    position: "absolute",
    top: -9,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 3,
  },
  saveBadge: {
    backgroundColor: "rgba(140, 40, 40, 0.92)",
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    minWidth: 40,
    alignItems: "center",
  },
  saveBadgeActive: {
    backgroundColor: "#E53935",
  },
  saveBadgeText: {
    fontSize: 7,
    fontWeight: "800",
    color: "rgba(255,255,255,0.9)",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  saveBadgeTextActive: {
    color: "#FFFFFF",
  },
  saveBadgePointer: {
    width: 0,
    height: 0,
    marginTop: -0.5,
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderTopWidth: 4,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(140, 40, 40, 0.92)",
  },
  saveBadgePointerActive: {
    borderTopColor: "#E53935",
  },
  periodActiveBtn: {
    width: "100%",
    flex: 1,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  periodCellFirst: {
    borderTopLeftRadius: 9,
    borderBottomLeftRadius: 9,
  },
  periodCellLast: {
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
  },
  periodActiveText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  periodIdleBtn: {
    width: "100%",
    flex: 1,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  periodIdleText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#8E8E93",
    textAlign: "center",
  },
  currentCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: PAGE.surface,
    borderRadius: 14,
    padding: 16,
  },
  currentTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  currentLabel: { fontSize: 13, color: PAGE.secondary },
  currentPlan: {
    fontSize: 24,
    fontWeight: "700",
    color: PAGE.text,
    marginTop: 2,
  },
  currentExpiry: {
    fontSize: 13,
    color: PAGE.secondary,
    marginTop: 8,
    lineHeight: 18,
  },
  perksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  perkChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: PAGE.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  perkText: { fontSize: 12, color: PAGE.text, fontWeight: "500" },
  planCardsRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  planCardShell: {
    marginRight: CARD_GAP,
    borderRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
    overflow: "hidden",
  },
  planCard: {
    flex: 1,
    borderRadius: 22,
    paddingTop: 16,
    paddingHorizontal: 14,
    paddingBottom: 12,
    overflow: "hidden",
  },
  planCardShine: {
    ...StyleSheet.absoluteFillObject,
  },
  planCardSheen: {
    ...StyleSheet.absoluteFillObject,
  },
  planCardSpecular: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.55,
  },
  popularRibbonWrap: {
    position: "absolute",
    top: 10,
    right: 0,
    width: POPULAR_TAG_W,
    height: POPULAR_TAG_H,
    zIndex: 3,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 10,
  },
  popularRibbonSvg: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  popularRibbonText: {
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 0.55,
    color: "#2A1C00",
    textAlign: "center",
  },
  planCardContent: {
    flex: 1,
    zIndex: 1,
  },
  planHeader: { marginBottom: 6, paddingRight: 100 },
  planTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  planName: {
    fontSize: 20,
    fontWeight: "800",
    flexShrink: 1,
  },
  planPrice: {
    fontSize: 24,
    fontWeight: "700",
    color: WA.text,
  },
  planPeriod: {
    fontSize: 13,
    fontWeight: "400",
    color: WA.secondary,
  },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  planBadgeText: { fontSize: 13, fontWeight: "800" },
  activePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  activePillOnLight: {
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  activePillOnDark: {
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  activePillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  featureList: {
    flex: 1,
    justifyContent: "space-evenly",
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    minHeight: 28,
  },
  featureCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontSize: 13,
    color: WA.text,
    flex: 1,
    fontWeight: "600",
  },
  subscribeBtnWrap: {
    borderRadius: 26,
    overflow: "hidden",
    marginTop: "auto",
  },
  subscribeBtn: {
    borderRadius: 26,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  subscribeBtnDisabled: { opacity: 0.55 },
  subscribeBtnText: {
    fontSize: 15,
    fontWeight: "700",
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    marginHorizontal: 16,
    paddingVertical: 4,
  },
  trustIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  trustText: {
    fontSize: 12,
    color: "#A8B0B8",
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  footnote: {
    fontSize: 11,
    color: PAGE.secondary,
    paddingHorizontal: 20,
    paddingTop: 12,
    lineHeight: 16,
  },
  termsLink: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    marginHorizontal: 20,
    paddingVertical: 8,
  },
  termsLinkText: {
    fontSize: 13,
    fontWeight: "400",
    color: "#8AB4F8",
    textAlign: "center",
    textDecorationLine: "underline",
  },
});
