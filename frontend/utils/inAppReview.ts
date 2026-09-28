import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import { Platform } from "react-native";

/**
 * Google Play in-app review (star dialog inside the app).
 * Asked only after a happy moment (new connection / active chatting),
 * never on first day, at most once per 90 days and 3 times ever.
 * Google also applies its own quota, so the dialog may silently not show.
 */

const KEY = "luvstor.inAppReview.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS_SINCE_FIRST_USE = 1;
const MIN_MESSAGES_SENT = 10;
const MIN_DAYS_BETWEEN_ASKS = 90;
const MAX_ASKS = 3;

type State = {
  firstUseAt: number;
  messagesSent: number;
  connections: number;
  lastAskedAt: number;
  asks: number;
};

let asking = false;

async function load(): Promise<State> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    /* corrupt / unavailable storage → start fresh */
  }
  const fresh = emptyState();
  await save(fresh);
  return fresh;
}

function emptyState(): State {
  return { firstUseAt: Date.now(), messagesSent: 0, connections: 0, lastAskedAt: 0, asks: 0 };
}

async function save(state: State) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}

function eligible(s: State, now = Date.now()) {
  if (s.asks >= MAX_ASKS) return false;
  if (now - s.firstUseAt < MIN_DAYS_SINCE_FIRST_USE * DAY_MS) return false;
  if (s.lastAskedAt && now - s.lastAskedAt < MIN_DAYS_BETWEEN_ASKS * DAY_MS) return false;
  return s.connections >= 1 || s.messagesSent >= MIN_MESSAGES_SENT;
}

async function maybeAsk(s: State) {
  if (Platform.OS !== "android" || asking || !eligible(s)) return;
  asking = true;
  try {
    if (!(await StoreReview.isAvailableAsync())) return;
    if (!(await StoreReview.hasAction())) return;
    s.lastAskedAt = Date.now();
    s.asks += 1;
    await save(s);
    await StoreReview.requestReview();
  } catch {
    /* never break the app over a rating prompt */
  } finally {
    asking = false;
  }
}

/** Call after the user sends a chat message (only counts, never prompts). */
export async function noteMessageSent() {
  const s = await load();
  s.messagesSent += 1;
  await save(s);
}

/** Call when the user leaves a chat — a natural pause to ask. */
export async function askReviewAfterChat() {
  await maybeAsk(await load());
}

/** Call when a new connection / mutual match is made. */
export async function noteConnectionMade() {
  const s = await load();
  s.connections += 1;
  await save(s);
  // Let the success UI settle before the Play dialog slides in
  setTimeout(() => void maybeAsk(s), 2000);
}
