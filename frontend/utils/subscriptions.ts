import { useEffect, useState } from "react";
import { apiRequest, fetchWithTimeout, getApiBase } from "./api";
import { RazorpayCheckout, isRazorpayAvailable } from "./razorpay.native";

export type SubscriptionPlanId =
  | "free"
  | "explore"
  | "gold"
  | "platinum"
  | "black";

export type BillingPeriodId = "monthly" | "quarterly" | "6months" | "annual";

export type BillingPeriod = {
  id: BillingPeriodId;
  label: string;
  days: number;
};

export type PlanPricing = Partial<Record<BillingPeriodId, number>>;

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
  explorePrefs?: boolean;
  /** Gold / Platinum / Black unlock Profile View identities */
  profileViews?: boolean;
  accent: string;
  paymentsEnabled?: boolean;
  tokensCredited?: number;
  tokenBalance?: number;
};

export type PlanFeatureSet = {
  chatSession: string;
  monthlyTokens: string | null;
  tokenBonus: string | null;
  dailySpin: string;
  discoverBoost: string | null;
  topSpotDaily: string | null;
  explorePrefs?: string | null;
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

function apiErrorMessage(error: any, fallback: string) {
  return (
    error?.message ||
    error?.description ||
    error?.data?.error ||
    fallback
  );
}

export async function fetchSubscriptionPlans(): Promise<{
  plans: SubscriptionPlan[];
  billingPeriods: BillingPeriod[];
  defaultPeriodId: BillingPeriodId;
  paymentsEnabled?: boolean;
}> {
  const res = await fetchWithTimeout(`${getApiBase()}/api/subscriptions/plans`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load plans");
  return data;
}

export async function fetchSubscriptionStatus(
  token: string,
): Promise<SubscriptionStatus> {
  return apiRequest("/api/subscriptions/status", token);
}

/** True when Explore gender / verified filters are unlocked. */
export function hasExplorePrefsAccess(status?: SubscriptionStatus | null) {
  return !!status?.explorePrefs;
}

export async function recoverSubscriptionOrder(
  authToken: string,
  orderId: string,
): Promise<{
  success: boolean;
  subscription?: SubscriptionStatus;
  error?: string;
}> {
  try {
    const verified = await apiRequest("/api/subscriptions/recover", authToken, {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
    if (verified.success && verified.verified) {
      return { success: true, subscription: verified as SubscriptionStatus };
    }
    return { success: false, error: "Recovery failed" };
  } catch (error: any) {
    return {
      success: false,
      error: apiErrorMessage(error, "Could not recover payment"),
    };
  }
}

export async function initiateSubscriptionPurchase(
  authToken: string,
  planId: string,
  periodId: BillingPeriodId,
  userName: string,
  userEmail: string,
): Promise<{
  success: boolean;
  subscription?: SubscriptionStatus;
  error?: string;
  orderId?: string;
}> {
  let orderId: string | undefined;
  try {
    if (!isRazorpayAvailable || !RazorpayCheckout) {
      // Do not Alert.alert here — callers often have a Modal open; nested
      // native Alert + Modal freezes the UI. Return error for the UI to show.
      return {
        success: false,
        error:
          "Subscriptions need the Luvstor APK (Razorpay is not in Expo Go).",
      };
    }

    const order = await apiRequest(
      "/api/subscriptions/create-order",
      authToken,
      {
        method: "POST",
        body: JSON.stringify({ planId, periodId }),
      },
    );

    if (!order.success || !order.orderId) {
      return {
        success: false,
        error: order.error || "Failed to create order",
      };
    }

    orderId = String(order.orderId);

    const payment = await RazorpayCheckout.open({
      description: `${order.planName} — ${order.periodLabel}`,
      currency: order.currency || "INR",
      key: order.keyId,
      amount: order.amount,
      name: "Luvstor",
      order_id: order.orderId,
      prefill: {
        name: userName || "User",
        email: userEmail || "",
      },
      theme: { color: "#6750A4" },
      retry: { enabled: true, max_count: 2 },
    });

    try {
      const verified = await apiRequest("/api/subscriptions/verify", authToken, {
        method: "POST",
        body: JSON.stringify({
          razorpay_order_id: payment.razorpay_order_id,
          razorpay_payment_id: payment.razorpay_payment_id,
          razorpay_signature: payment.razorpay_signature,
        }),
      });

      if (verified.success && verified.verified) {
        return {
          success: true,
          subscription: verified as SubscriptionStatus,
          orderId,
        };
      }
      return { success: false, error: "Verification failed", orderId };
    } catch (verifyErr: any) {
      // Payment may have succeeded — try recover once
      const recovered = await recoverSubscriptionOrder(authToken, orderId!);
      if (recovered.success) return { ...recovered, orderId };
      return {
        success: false,
        error: apiErrorMessage(verifyErr, "Verification failed"),
        orderId,
      };
    }
  } catch (error: any) {
    if (error?.code === 0 || /cancel/i.test(String(error?.description || error?.message || ""))) {
      return { success: false, error: "Payment cancelled", orderId };
    }
    // If checkout closed after pay, recover by order id
    if (orderId) {
      const recovered = await recoverSubscriptionOrder(authToken, orderId);
      if (recovered.success) return { ...recovered, orderId };
    }
    return {
      success: false,
      error: apiErrorMessage(error, "Payment failed"),
      orderId,
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
    case "explore":
      return "#6750A4";
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
