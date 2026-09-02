import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import DeviceTransferModal from "../components/DeviceTransferModal";
import { useAuth } from "../contexts/AuthContext";
import { ApiError, apiSendOTP, apiVerifyOTP } from "../utils/api";
import { resolvePostLoginRoute } from "../utils/auth";

const OTP_LENGTH = 6;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

/** Same palette as Sign In */
const C = {
  primary: "#7C3AED",
  white: "#FFFFFF",
  ink: "#1A1A2E",
  muted: "#6B6B6B",
  inputBg: "#F2F2F2",
  error: "#E53935",
  yellow: "#F5D547",
};

const HERO_SLIDES = [
  {
    title: "Check your inbox",
    subtitle: "Your code is on the way",
    image: require("../assets/images/login-hero.png"),
    color: "#7C3AED",
  },
  {
    title: "Almost there!",
    subtitle: "Enter the 6-digit code",
    image: require("../assets/images/login-hero-2.png"),
    color: "#E85D75",
  },
  {
    title: "Stay secure",
    subtitle: "Codes expire in a few minutes",
    image: require("../assets/images/login-hero-3.png"),
    color: "#2BB3C0",
  },
  {
    title: "Welcome back",
    subtitle: "Verify to continue chatting",
    image: require("../assets/images/login-hero-4.png"),
    color: "#F59E0B",
  },
];

export default function OtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const { email, cooldown } = useLocalSearchParams<{
    email: string;
    cooldown?: string;
  }>();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [deviceConflict, setDeviceConflict] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [slide, setSlide] = useState(0);

  const inputs = useRef<(TextInput | null)[]>([]);
  const heroColorAnim = useRef(new Animated.Value(0)).current;
  const slideRef = useRef(0);

  const busy = verifying || transferring;
  const hero = HERO_SLIDES[slide];
  const fromColor = HERO_SLIDES[slideRef.current]?.color ?? C.primary;
  const toColor = hero.color;
  const heroBg = heroColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [fromColor, toColor],
  });

  useEffect(() => {
    heroColorAnim.setValue(0);
    Animated.timing(heroColorAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: false,
    }).start(() => {
      slideRef.current = slide;
    });
  }, [slide, heroColorAnim]);

  useEffect(() => {
    const id = setInterval(() => {
      setSlide((n) => (n + 1) % HERO_SLIDES.length);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const initial = parseInt(cooldown || "0", 10);
    if (initial > 0) setResendCooldown(initial);
  }, [cooldown]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleChange = (text: string, index: number) => {
    if (error) setError("");
    if (deviceConflict) setDeviceConflict(false);

    // Paste full code
    const digits = text.replace(/[^0-9]/g, "");
    if (digits.length > 1) {
      const next = Array(OTP_LENGTH).fill("");
      for (let i = 0; i < Math.min(digits.length, OTP_LENGTH); i++) {
        next[i] = digits[i];
      }
      setOtp(next);
      const focusAt = Math.min(digits.length, OTP_LENGTH) - 1;
      inputs.current[focusAt]?.focus();
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = digits;
    setOtp(newOtp);
    if (digits && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
    }
  };

  const finishLogin = async (token: string, user: any) => {
    const accountEmail = String(user.email || email)
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

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH) {
      setError("Enter the complete 6-digit code");
      return;
    }
    if (!email) {
      setError("Missing email. Go back and try again.");
      return;
    }

    setError("");
    setDeviceConflict(false);
    setVerifying(true);
    Keyboard.dismiss();

    try {
      const result = await apiVerifyOTP(email, code);
      await finishLogin(result.token, result.user);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === "DEVICE_IN_USE") {
        setDeviceConflict(true);
        setError(err.message);
      } else {
        setError(err.message || "Verification failed");
      }
    } finally {
      setVerifying(false);
    }
  };

  const handleTransferDevice = async () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH || !email) return;

    setTransferring(true);
    setError("");
    Keyboard.dismiss();

    try {
      const result = await apiVerifyOTP(email, code, { forceTransfer: true });
      setDeviceConflict(false);
      await finishLogin(result.token, result.user);
    } catch (err: any) {
      setDeviceConflict(false);
      setError(
        err.message ||
          "Could not transfer device. Request a new code and try again.",
      );
    } finally {
      setTransferring(false);
    }
  };

  const handleResend = async () => {
    if (!email || resendCooldown > 0 || resending) return;

    setResending(true);
    setError("");
    setDeviceConflict(false);

    try {
      const result = await apiSendOTP(email);
      setOtp(Array(OTP_LENGTH).fill(""));
      inputs.current[0]?.focus();
      setResendCooldown(result.resendCooldownSeconds ?? 60);
    } catch (err: any) {
      setError(err.message || "Could not resend code");
    } finally {
      setResending(false);
    }
  };

  const filledCount = otp.filter((d) => d !== "").length;

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
            {/* ── Coloured hero (same style as Sign In) ── */}
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
                <TouchableOpacity
                  onPress={() => router.back()}
                  style={s.backBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
                </TouchableOpacity>
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
              <Text style={s.sheetTitle}>Email verification</Text>
              <View style={s.emailRow}>
                <Text style={s.emailText} numberOfLines={1}>
                  {email || "your email"}
                </Text>
                <TouchableOpacity
                  onPress={() => router.back()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={busy}
                >
                  <Text style={s.changeLink}>Change</Text>
                </TouchableOpacity>
              </View>

              <View style={s.otpRow}>
                {otp.map((digit, index) => {
                  const isFocused = focusedIndex === index;
                  return (
                    <TextInput
                      key={index}
                      ref={(ref) => {
                        inputs.current[index] = ref;
                      }}
                      style={[
                        s.otpBox,
                        isFocused && s.otpBoxFocused,
                        digit ? s.otpBoxFilled : null,
                        error && !deviceConflict ? s.otpBoxError : null,
                      ]}
                      value={digit}
                      onChangeText={(text) => handleChange(text, index)}
                      onKeyPress={(e) => handleKeyPress(e, index)}
                      keyboardType="number-pad"
                      maxLength={index === 0 ? OTP_LENGTH : 1}
                      selectTextOnFocus
                      editable={!busy}
                      onFocus={() => setFocusedIndex(index)}
                      onBlur={() => setFocusedIndex(null)}
                    />
                  );
                })}
              </View>

              {error && !deviceConflict ? (
                <View style={s.errorRow}>
                  <Ionicons name="alert-circle" size={14} color={C.error} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleVerify}
                activeOpacity={0.88}
                disabled={busy || filledCount < OTP_LENGTH || deviceConflict}
                style={[
                  s.primaryBtn,
                  (busy || filledCount < OTP_LENGTH || deviceConflict) &&
                    s.primaryBtnDisabled,
                ]}
              >
                {verifying ? (
                  <ActivityIndicator color={C.ink} size="small" />
                ) : (
                  <Text style={s.primaryBtnText}>Verify & Continue</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleResend}
                disabled={resendCooldown > 0 || resending || busy}
                style={s.resendRow}
              >
                {resending ? (
                  <ActivityIndicator color={C.primary} size="small" />
                ) : (
                  <Text
                    style={[
                      s.resendText,
                      (resendCooldown > 0 || busy) && s.resendTextDisabled,
                    ]}
                  >
                    {resendCooldown > 0
                      ? `Resend code in ${resendCooldown}s`
                      : "Resend verification code"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
        </Animated.View>
      </TouchableWithoutFeedback>

      <DeviceTransferModal
        visible={deviceConflict}
        alertText={error || "Already logged in on another device"}
        message="Reinstalled the app or switched phones? Transfer this account to this device after verifying your identity."
        buttonText="Transfer Device"
        loading={transferring}
        disabled={filledCount < OTP_LENGTH}
        onTransfer={handleTransferDevice}
        onDismiss={() => {
          setDeviceConflict(false);
          setError("");
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
    justifyContent: "space-between",
    marginBottom: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { marginTop: -4 },
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
    transform: [{ translateY: 140 }],
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 0,
    transform: [{ translateY: 120 }],
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
    marginTop: 130,
    paddingHorizontal: 24,
    paddingTop: 40,
    overflow: "hidden",
    zIndex: 2,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.ink,
    letterSpacing: -0.3,
  },
  sheetSub: {
    marginTop: 6,
    fontSize: 14,
    color: C.muted,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
    marginBottom: 18,
  },
  emailText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "400",
    color: C.muted,
  },
  changeLink: {
    fontSize: 12,
    fontWeight: "700",
    color: C.muted,
  },

  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 14,
    textAlign: "center",
    fontSize: 22,
    fontWeight: "700",
    color: C.ink,
    backgroundColor: C.inputBg,
  },
  otpBoxFocused: {
    borderColor: "#D4D4D8",
    backgroundColor: "#F7F7F8",
  },
  otpBoxFilled: {
    borderColor: "#D4D4D8",
    backgroundColor: "#F7F7F8",
  },
  otpBoxError: {
    borderColor: C.error,
  },

  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 12,
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

  resendRow: {
    marginTop: 20,
    alignItems: "center",
  },
  resendText: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  resendTextDisabled: {
    color: C.muted,
  },
});
