import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Keyboard,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import DeviceTransferModal from "../components/DeviceTransferModal";
import {
    getGoogleAuthConfigHint,
    isGoogleAuthConfigured,
} from "../config/googleAuth";
import { useAuth } from "../contexts/AuthContext";
import { mapGoogleSignInError, useGoogleAuth } from "../hooks/useGoogleAuth";
import { ApiError, apiGoogleLogin, apiSendOTP } from "../utils/api";
import { resolvePostLoginRoute } from "../utils/auth";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

/** Official multicolor Google "G" mark */
function GoogleLogo({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/** Luvstor brand palette (matches welcome) */
const C = {
  primary: "#7C3AED",
  white: "#FFFFFF",
  ink: "#1A1A2E",
  muted: "#6B6B6B",
  inputBg: "#F2F2F2",
  error: "#E53935",
  googleBorder: "#DADCE0",
  yellow: "#F5D547",
};

const HERO_SLIDES = [
  {
    title: "Meet someone new!",
    subtitle: "Chat, match & find your spark",
    image: require("../assets/images/login-hero.png"),
    color: "#7C3AED", // Luvstor purple
  },
  {
    title: "Real people nearby",
    subtitle: "Discover matches around you",
    image: require("../assets/images/login-hero-2.png"),
    color: "#E85D75", // rose
  },
  {
    title: "Safe & private",
    subtitle: "Your email stays with you",
    image: require("../assets/images/login-hero-3.png"),
    color: "#2BB3C0", // teal
  },
  {
    title: "Say hi today",
    subtitle: "Start a chat that feels easy",
    image: require("../assets/images/login-hero-4.png"),
    color: "#F59E0B", // amber (pairs with yellow shirt)
  },
];

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const { signIn, ready, requiresDevBuild } = useGoogleAuth();

  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState("");
  const [deviceConflict, setDeviceConflict] = useState(false);
  const [pendingIdToken, setPendingIdToken] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const heroColorAnim = React.useRef(new Animated.Value(0)).current;
  const slideRef = React.useRef(0);

  const busy = otpLoading || googleLoading || transferring;
  const hero = HERO_SLIDES[slide];
  const prevSlide = slideRef.current;
  const fromColor = HERO_SLIDES[prevSlide]?.color ?? C.primary;
  const toColor = hero.color;

  // Smoothly blend hero background between slide colours
  const heroBg = heroColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [fromColor, toColor],
  });

  React.useEffect(() => {
    heroColorAnim.setValue(0);
    Animated.timing(heroColorAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: false,
    }).start(() => {
      slideRef.current = slide;
    });
  }, [slide, heroColorAnim]);

  // Cycle hero poses + colours one by one in the same position
  React.useEffect(() => {
    const id = setInterval(() => {
      setSlide((n) => (n + 1) % HERO_SLIDES.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  const finishLogin = async (token: string, user: any) => {
    const accountEmail = String(user.email || "")
      .trim()
      .toLowerCase();
    const hydratedUser = await loginWithToken(token, {
      id: user.id,
      email: accountEmail,
      name: user.name,
      profileComplete: user.profileComplete,
    });
    const nextRoute = await resolvePostLoginRoute(hydratedUser);
    router.replace(nextRoute as any);
  };

  const handleSendOtp = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email address");
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setError("Please enter a valid email address");
      return;
    }

    setError("");
    setDeviceConflict(false);
    setOtpLoading(true);
    Keyboard.dismiss();

    try {
      const result = await apiSendOTP(trimmed);
      const cooldown = result.resendCooldownSeconds ?? 60;
      router.push(
        `/otp?email=${encodeURIComponent(trimmed)}&cooldown=${cooldown}` as any,
      );
    } catch (err: any) {
      setError(err.message || "Could not send OTP. Check your connection.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleGoogleSignIn = async (forceTransfer = false) => {
    if (!isGoogleAuthConfigured()) {
      setError(getGoogleAuthConfigHint());
      return;
    }

    setError("");
    if (!forceTransfer) setDeviceConflict(false);
    setGoogleLoading(true);

    try {
      let idToken = pendingIdToken;
      if (!idToken || !forceTransfer) {
        idToken = await signIn();
        setPendingIdToken(idToken);
      }

      const result = await apiGoogleLogin(idToken, { forceTransfer });
      setPendingIdToken(null);
      setDeviceConflict(false);
      await finishLogin(result.token, result.user);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "DEVICE_IN_USE") {
        setDeviceConflict(true);
        setError(err.message);
      } else if (err.message === "Sign-in cancelled") {
        setError("");
      } else {
        setDeviceConflict(false);
        setPendingIdToken(null);
        setError(mapGoogleSignInError(err));
      }
    } finally {
      setGoogleLoading(false);
      setTransferring(false);
    }
  };

  const handleTransferDevice = async () => {
    setTransferring(true);
    await handleGoogleSignIn(true);
  };

  return (
    <>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <Animated.View style={[s.root, { backgroundColor: heroBg }]}>
          <StatusBar barStyle="light-content" backgroundColor={hero.color} />

          <KeyboardAwareScrollView
            style={s.flex}
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            bottomOffset={24}
          >
            {/* ── Coloured hero (changes with each pose) ── */}
            <Animated.View
              style={[
                s.hero,
                {
                  paddingTop: Math.max(insets.top, 8) + 4,
                  backgroundColor: heroBg,
                },
              ]}
            >
              <View style={s.heroTopRow}>
                <View style={s.shieldWrap}>
                  <Ionicons name="shield-checkmark" size={22} color="#FFFFFF" />
                </View>
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setSlide((n) => (n + 1) % HERO_SLIDES.length)}
                style={s.heroCopy}
              >
                <Text style={s.heroTitle}>{hero.title}</Text>
                <Text style={s.heroSubtitle}>{hero.subtitle}</Text>
              </TouchableOpacity>

              <View style={s.illustration}>
                <Image
                  key={slide}
                  source={hero.image}
                  style={s.heroImage}
                  contentFit="contain"
                  transition={400}
                />
              </View>

              <View style={s.dots}>
                {HERO_SLIDES.map((_, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setSlide(i)}
                    hitSlop={8}
                    style={[s.dot, i === slide ? s.dotActive : null]}
                  />
                ))}
              </View>
            </Animated.View>

            {/* ── White sheet ── */}
            <View
              style={[
                s.sheet,
                { paddingBottom: Math.max(insets.bottom, 20) + 12 },
              ]}
            >
              <Text style={s.sheetTitle}>Email address</Text>

              <View
                style={[
                  s.inputBox,
                  focused && s.inputBoxFocused,
                  error && !deviceConflict ? s.inputBoxError : null,
                ]}
              >
                <TextInput
                  style={s.textInput}
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (error) setError("");
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  placeholder="you@gmail.com"
                  placeholderTextColor="#9E9E9E"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  editable={!busy}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOtp}
                />
              </View>

              {error && !deviceConflict ? (
                <View style={s.errorRow}>
                  <Ionicons name="alert-circle" size={14} color={C.error} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleSendOtp}
                activeOpacity={0.88}
                disabled={busy || !email.trim() || deviceConflict}
                style={[
                  s.primaryBtn,
                  (!email.trim() || busy || deviceConflict) &&
                    s.primaryBtnDisabled,
                ]}
              >
                {otpLoading ? (
                  <ActivityIndicator color={C.ink} size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Get OTP</Text>
                )}
              </TouchableOpacity>

              <View style={s.orRow}>
                <View style={s.orLine} />
                <Text style={s.orText}>or</Text>
                <View style={s.orLine} />
              </View>

              <TouchableOpacity
                onPress={() => handleGoogleSignIn(false)}
                activeOpacity={0.85}
                disabled={
                  busy || (!ready && !requiresDevBuild) || deviceConflict
                }
                style={[
                  s.googleBtn,
                  (busy || (!ready && !requiresDevBuild) || deviceConflict) && {
                    opacity: 0.65,
                  },
                ]}
              >
                {googleLoading && !transferring ? (
                  <ActivityIndicator color="#4285F4" size="small" />
                ) : (
                  <>
                    <GoogleLogo size={20} />
                    <Text style={s.googleBtnText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={s.terms}>
                By proceeding I accept the{" "}
                <Text style={s.termsBold}>Community Guidelines</Text>
                {" & "}
                <Text style={s.termsBold}>Terms of Use</Text>
              </Text>
            </View>
          </KeyboardAwareScrollView>
        </Animated.View>
      </TouchableWithoutFeedback>

      <DeviceTransferModal
        visible={deviceConflict}
        alertText={error || "Already logged in on another device"}
        message="This Google account is active on another device. Transfer it to this phone?"
        buttonText="Transfer to This Device"
        loading={transferring}
        disabled={googleLoading && !transferring}
        onTransfer={handleTransferDevice}
        onDismiss={() => {
          setDeviceConflict(false);
          setError("");
          setPendingIdToken(null);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.primary },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    minHeight: SCREEN_H,
  },

  hero: {
    paddingHorizontal: 22,
    paddingBottom: 0,
    minHeight: SCREEN_W * 0.72,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: 4,
  },
  shieldWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: {
    marginTop: -4,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    fontWeight: "500",
    marginTop: 2,
  },
  illustration: {
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: 8,
    marginBottom: 0,
    height: SCREEN_W * 0.5,
    overflow: "visible",
  },
  heroImage: {
    width: SCREEN_W * 0.74,
    height: SCREEN_W * 0.64,
    transform: [{ translateY: 63 }],
  },

  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 0,
    transform: [{ translateY: 45 }],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  dotActive: {
    width: 22,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },

  sheet: {
    flexGrow: 1,
    backgroundColor: C.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: 55,
    paddingHorizontal: 24,
    paddingTop: 40,
    overflow: "hidden",
    zIndex: 2,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.ink,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  inputBox: {
    backgroundColor: C.inputBg,
    borderRadius: 16,
    height: 56,
    paddingHorizontal: 18,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  inputBoxFocused: {
    borderColor: "#D4D4D8",
    backgroundColor: "#F7F7F8",
  },
  inputBoxError: {
    borderColor: C.error,
  },
  textInput: {
    fontSize: 16,
    color: C.ink,
    fontWeight: "500",
    paddingVertical: 0,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 10,
  },
  errorText: {
    flex: 1,
    color: C.error,
    fontSize: 13,
    fontWeight: "500",
  },

  primaryBtn: {
    marginTop: 22,
    backgroundColor: C.yellow,
    borderRadius: 100,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    color: C.ink,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  orRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
    gap: 12,
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#D0D0D0",
  },
  orText: {
    fontSize: 12,
    color: C.muted,
    fontWeight: "600",
    textTransform: "uppercase",
  },

  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: C.googleBorder,
    backgroundColor: "#FFFFFF",
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#3C4043",
  },

  terms: {
    marginTop: 22,
    textAlign: "center",
    fontSize: 12,
    color: C.muted,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  termsBold: {
    color: C.ink,
    fontWeight: "700",
  },
});
