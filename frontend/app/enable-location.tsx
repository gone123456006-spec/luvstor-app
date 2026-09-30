import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  LayoutAnimation,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../contexts/AuthContext";
import { getAuthToken } from "../utils/auth";
import {
  markLocationSetupSkipped,
  requestLocationAccess,
  useLocationAccess,
} from "../utils/locationSetup";
import { uploadMyLocation } from "../utils/nearby";

const C = {
  bg: "#16051F",
  card: "#2A0F3D",
  accent: "#8B3DFF",
  white: "#FFFFFF",
  muted: "#B9A8CC",
  warn: "#FFB4A8",
};

export default function EnableLocationScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { access, setAccess } = useLocationAccess();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const leavingRef = useRef(false);

  const goHome = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    router.replace("/(tabs)");
  }, [router]);

  const finishWithLocation = useCallback(async () => {
    if (leavingRef.current) return;
    setBusy(true);
    try {
      const token = await getAuthToken();
      // Saving the first real fix marks setup complete on the server.
      if (token) await uploadMyLocation(token, { timeoutMs: 10000 });
    } finally {
      goHome();
    }
  }, [goHome]);

  useEffect(() => {
    if (!user) router.replace("/login");
  }, [user, router]);

  // Permission granted here or in Settings → continue automatically.
  useEffect(() => {
    if (access.status === "granted") void finishWithLocation();
  }, [access.status, finishWithLocation]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await requestLocationAccess();
      setAccess(next);
      setAsked(true);
    } finally {
      if (!leavingRef.current) setBusy(false);
    }
  };

  const onNotNow = async () => {
    if (user?.id) await markLocationSetupSkipped(user.id);
    goHome();
  };

  const blocked = access.status === "blocked";
  const gpsOff = access.status === "services-off";
  const buttonLabel = blocked
    ? "Open Settings"
    : gpsOff
      ? "Turn on Location"
      : "Continue";

  let hint: string | null = null;
  if (blocked) {
    hint =
      "Location is turned off for Luvstor. Open Settings → Permissions → Location and choose “Allow while using the app”.";
  } else if (gpsOff) {
    hint = "Your phone's Location / GPS is off. Turn it on to continue.";
  } else if (asked && access.status === "denied") {
    hint = "Luvstor needs your location to show people near you.";
  }

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.content}>
        <View style={s.iconOuter}>
          <View style={s.iconInner}>
            <Ionicons name="location" size={56} color={C.white} />
          </View>
        </View>

        <Text style={s.title}>So, are you from around here?</Text>
        <Text style={s.body}>
          Set your location to see who's in your neighbourhood or beyond.
          You won't be able to see Nearby people otherwise.
        </Text>

        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>

      <View style={s.footer}>
        <TouchableOpacity
          style={[s.button, busy && s.buttonBusy]}
          onPress={onContinue}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={s.buttonText}>{buttonLabel}</Text>
          )}
        </TouchableOpacity>

        {(asked || blocked || gpsOff) && !busy ? (
          <TouchableOpacity
            onPress={onNotNow}
            style={s.notNow}
            accessibilityRole="button"
          >
            <Text style={s.notNowText}>Not now</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={s.infoRow}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowInfo((v) => !v);
          }}
          accessibilityRole="button"
        >
          <Text style={s.infoTitle}>How is my location used?</Text>
          <Ionicons
            name={showInfo ? "chevron-up" : "chevron-down"}
            size={18}
            color={C.muted}
          />
        </TouchableOpacity>
        {showInfo ? (
          <Text style={s.infoBody}>
            Your location is used only to find people near you and show an
            approximate distance on profiles (like “3 km away”). Your exact
            location is never shown to other users. You can change this anytime
            in your phone's Settings.
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  iconOuter: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 36,
  },
  iconInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: C.white,
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 14,
  },
  body: {
    color: C.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  hint: {
    color: C.warn,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 18,
  },
  footer: { paddingHorizontal: 24, paddingBottom: 16 },
  button: {
    height: 54,
    borderRadius: 27,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: C.white, fontSize: 17, fontWeight: "700" },
  notNow: { alignSelf: "center", paddingVertical: 14 },
  notNowText: { color: C.muted, fontSize: 15, fontWeight: "600" },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  infoTitle: { color: C.white, fontSize: 14, fontWeight: "600" },
  infoBody: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 8,
  },
});
