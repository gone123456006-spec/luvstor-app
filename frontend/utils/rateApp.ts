import * as Application from "expo-application";
import { openBrowserAsync } from "expo-web-browser";
import { Alert, Linking, Platform } from "react-native";

/** Same applicationId as frontend/app.json android.package */
export const PLAY_STORE_PACKAGE = "com.luvstor.app";

function playPackageId() {
  return Application.applicationId || PLAY_STORE_PACKAGE;
}

export function playStoreWebUrl(pkg = playPackageId()) {
  return `https://play.google.com/store/apps/details?id=${pkg}`;
}

function playStoreMarketUrl(pkg = playPackageId()) {
  return `market://details?id=${pkg}`;
}

/**
 * Explicit Play Store intent. Linking.openURL("market://…") often does
 * nothing on Android 11+ because it does not set package=com.android.vending.
 */
function playStoreIntentUrl(pkg = playPackageId()) {
  const fallback = encodeURIComponent(playStoreWebUrl(pkg));
  return (
    `intent://details?id=${pkg}#Intent;` +
    `scheme=market;` +
    `action=android.intent.action.VIEW;` +
    `package=com.android.vending;` +
    `S.browser_fallback_url=${fallback};` +
    `end`
  );
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens Luvstor on Google Play so the user can rate the app.
 * Always targets the Play Store app on Android; falls back to the public listing.
 */
export async function openPlayStoreToRate(): Promise<boolean> {
  const pkg = playPackageId();
  const https = playStoreWebUrl(pkg);

  if (Platform.OS === "android") {
    if (await tryOpen(playStoreIntentUrl(pkg))) return true;
    if (await tryOpen(playStoreMarketUrl(pkg))) return true;
  }

  if (await tryOpen(https)) return true;

  try {
    await openBrowserAsync(https);
    return true;
  } catch {
    /* last resort below */
  }

  Alert.alert(
    "Couldn’t open Play Store",
    "Search for Luvstor on Google Play to rate the app.",
  );
  return false;
}
