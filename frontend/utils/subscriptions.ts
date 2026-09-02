import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { apiRequest, getApiBase } from "./api";
import { RazorpayCheckout, isRazorpayAvailable } from "./razorpay.native";

export type SubscriptionPlanId = "free" | "gold" | "platinum" | "black";

export type BillingPeriodId = "monthly" | "quarterly" | "6months" | "annual";

export type BillingPeriod = {
  id: BillingPeriodId;
  label: string;
  days: number;
};

export type PlanPricing = Record<BillingPeriodId, number>;

export type SubscriptionStatus = {
  plan: SubscriptionPlanId;
  planName: string;
  badge: string | null;
  isActive: boolean;
  expiresAt: string | null;
  storedPlan: SubscriptionPlanId;
  chatSessionHours: number | null;
  unlimitedChat?: boolean;
  tokenBonusPercent: number;
  monthlyTokenGrant: number;
  spinsPerDay: number;
  spinsRemaining: number;
  spinsUsedToday: number;
  canSpin: boolean;
  discoverBoost: boolean;
  topSpotDaily: boolean;
  accent: string;
};

export type PlanFeatureSet = {
  chatSession: string;
  monthlyTokens: string | null;
  tokenBonus: string | null;
  dailySpin: string;
  discoverBoost: string | null;
  topSpotDaily: string | null;
  calls: string;
  badge: string | null;
};

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  name: string;
  pricing: PlanPricing;
  accent: string;
  badge: string | null;
  features: PlanFeatureSet;
};

export async function fetchSubscriptionPlans(): Promise<{
  plans: SubscriptionPlan[];
  billingPeriods: BillingPeriod[];
  defaultPeriodId: BillingPeriodId;
}> {
  const res = await fetch(`${getApiBase()}/api/subscriptions/plans`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load plans");
  return data;
}

export async function fetchSubscriptionStatus(
  token: string,
): Promise<SubscriptionStatus> {
  return apiRequest("/api/subscriptions/status", token);
}

export async function initiateSubscriptionPurchase(
  authToken: string,
  planId: string,
  periodId: BillingPeriodId,
  userName: string,
  userEmail: string,
): Promise<{
  success: boolean;
  subscription?: SubscriptionStatus & {
    tokensCredited?: number;
    tokenBalance?: number;
  };
  error?: string;
}> {
  try {
    if (!isRazorpayAvailable || !RazorpayCheckout) {
      Alert.alert(
        "Development Build Required",
        "Subscriptions require a development build with Razorpay.\n\nnpx expo run:android",
      );
      return { success: false, error: "Razorpay not available" };
    }

    const order = await apiRequest(
      "/api/subscriptions/create-order",
      authToken,
      {
        method: "POST",
        body: JSON.stringify({ planId, periodId }),
      },
    );

    if (!order.success) {
      return { success: false, error: "Failed to create order" };
    }

    const payment = await RazorpayCheckout.open({
      description: `${order.planName} — ${order.periodLabel}`,
      currency: order.currency,
      key: order.keyId,
      amount: order.amount,
      name: "Luvstor",
      order_id: order.orderId,
      prefill: { name: userName || "User", email: userEmail || "" },
      theme: { color: "#6750A4" },
    });

    const verified = await apiRequest("/api/subscriptions/verify", authToken, {
      method: "POST",
      body: JSON.stringify({
        razorpay_order_id: payment.razorpay_order_id,
        razorpay_payment_id: payment.razorpay_payment_id,
        razorpay_signature: payment.razorpay_signature,
        planId,
        periodId,
      }),
    });

    if (verified.success && verified.verified) {
      return { success: true, subscription: verified as SubscriptionStatus };
    }
    return { success: false, error: "Verification failed" };
  } catch (error: any) {
    if (error?.code === 0)
      return { success: false, error: "Payment cancelled" };
    return {
      success: false,
      error: error?.description || error?.message || "Payment failed",
    };
  }
}

export const COMPARISON_ROWS: {
  key: keyof PlanFeatureSet | "chatAccess" | "monthlyTokens";
  label: string;
  free: string;
  gold: string;
  platinum: string;
  black: string;
}[] = [
  {
    key: "chatAccess",
    label: "Chat session",
    free: "2 hours",
    gold: "6 hours",
    platinum: "12 hours",
    black: "24 hours",
  },
  {
    key: "monthlyTokens",
    label: "Tokens included",
    free: "—",
    gold: "100",
    platinum: "350",
    black: "1,200",
  },
  {
    key: "tokenBonus",
    label: "Bonus",
    free: "—",
    gold: "+10%",
    platinum: "+25%",
    black: "+40%",
  },
  {
    key: "dailySpin",
    label: "Daily spin",
    free: "1/day",
    gold: "2/day",
    platinum: "4/day",
    black: "Unlimited*",
  },
  {
    key: "discoverBoost",
    label: "Discover boost",
    free: "—",
    gold: "—",
    platinum: "Priority listing",
    black: "Daily 40-min top spot",
  },
  {
    key: "calls",
    label: "Voice & video",
    free: "Friends only",
    gold: "Friends only",
    platinum: "Friends only",
    black: "Friends only",
  },
  {
    key: "badge",
    label: "Profile badge",
    free: "—",
    gold: "Gold",
    platinum: "Platinum",
    black: "Black",
  },
];

export type PlanBadgeId = "gold" | "platinum" | "black";

export function resolvePlanBadge(raw?: string | null): PlanBadgeId | null {
  const v = String(raw || "").toLowerCase();
  if (v.includes("gold")) return "gold";
  if (v.includes("platinum")) return "platinum";
  if (v.includes("black")) return "black";
  return null;
}

/** True while a paid plan is still within its expiry window. */
export function isLiveSubscriptionBadge(
  badge?: string | null,
  expiresAt?: string | Date | null,
): boolean {
  if (!resolvePlanBadge(badge)) return false;
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/** Drops the tick the moment `expiresAt` is reached, even if the list is stale. */
export function useLiveSubscriptionBadge(
  badge?: string | null,
  expiresAt?: string | Date | null,
): string | null {
  const [live, setLive] = useState<string | null>(() =>
    isLiveSubscriptionBadge(badge, expiresAt) ? String(badge) : null,
  );

  useEffect(() => {
    if (!isLiveSubscriptionBadge(badge, expiresAt)) {
      setLive(null);
      return;
    }
    setLive(String(badge));
    if (!expiresAt) return;
    const left = new Date(expiresAt).getTime() - Date.now();
    const delay = Math.min(Math.max(0, left), 2_147_483_647);
    const timer = setTimeout(() => setLive(null), delay);
    return () => clearTimeout(timer);
  }, [badge, expiresAt]);

  return live;
}

export function planBadgeColor(plan: SubscriptionPlanId): string {
  switch (plan) {
    case "gold":
      return "#FFD700";
    case "platinum":
      return "#C0C0C0";
    case "black":
      return "#1C1B1F";
    default:
      return "#8696A0";
  }
}

export function formatExpiry(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
