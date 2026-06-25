import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Keyboard,
  TouchableWithoutFeedback,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { apiSendOTP, apiVerifyOTP } from "../utils/api";
import { resolvePostLoginRoute } from "../utils/auth";
import { useAuth } from "../contexts/AuthContext";

const OTP_LENGTH = 6;

// ── Google Material 3 Design Colors ─────────────────────────
const MD3 = {
  primary: "#6750A4",          // MD3 Purple
  onPrimary: "#FFFFFF",
  primaryContainer: "#EADDFF",
  onPrimaryContainer: "#21005D",
  surface: "#FEF7FF",          // MD3 light background
  onSurface: "#1D1B20",
  surfaceVariant: "#E7E0EC",
  onSurfaceVariant: "#49454F",
  outline: "#79747E",
  outlineVariant: "#CAC4D0",
  error: "#B3261E",
  success: "#386A20",
};

export default function OtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginWithToken } = useAuth();
  const { email, cooldown } = useLocalSearchParams<{ email: string; cooldown?: string }>();

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const inputs = useRef<(TextInput | null)[]>([]);

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
    const digit = text.replace(/[^0-9]/g, "");
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    // Auto focus next box
    if (digit && index < OTP_LENGTH - 1) {
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
    setVerifying(true);
    Keyboard.dismiss();

    try {
      const result = await apiVerifyOTP(email, code);
      const accountEmail = String(result.user.email || email).trim().toLowerCase();

      const hydratedUser = await loginWithToken(result.token, {
        id: result.user.id,
        email: accountEmail,
        name: result.user.name,
        profileComplete: result.user.profileComplete,
      });

      const nextRoute = await resolvePostLoginRoute(hydratedUser);
      router.replace(nextRoute as any);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email || resendCooldown > 0 || resending) return;

    setResending(true);
    setError("");

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
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.container}>
        <StatusBar barStyle="dark-content" backgroundColor={MD3.surface} />
        
        <SafeAreaView style={s.safeArea} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={s.keyboardView}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerStyle={s.scroll}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={s.card}>
                
                {/* Brand Logo & Header */}
                <View style={s.headerContainer}>
                  <Image
                    source={require("../assets/images/luvstoer logo.png")}
                    style={s.logo}
                    contentFit="contain"
                  />
                  <Text style={s.title}>2-Step Verification</Text>
                  <Text style={s.subtitle}>
                    A 6-digit verification code has been sent to
                  </Text>
                  <Text style={s.emailBadge}>{email || "your email"}</Text>
                </View>

                {/* 6 Digit Input Row */}
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
                          error ? s.otpBoxError : null,
                        ]}
                        value={digit}
                        onChangeText={(text) => handleChange(text, index)}
                        onKeyPress={(e) => handleKeyPress(e, index)}
                        keyboardType="number-pad"
                        maxLength={1}
                        selectTextOnFocus
                        onFocus={() => setFocusedIndex(index)}
                        onBlur={() => setFocusedIndex(null)}
                      />
                    );
                  })}
                </View>

                {/* Status / Error Labels */}
                {error ? (
                  <View style={s.errorRow}>
                    <Ionicons name="error-outline" size={16} color={MD3.error} />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                ) : (
                  <Text style={s.hintText}>Enter the security code to proceed</Text>
                )}

                {/* Action Button */}
                <TouchableOpacity
                  onPress={handleVerify}
                  activeOpacity={0.8}
                  disabled={verifying || filledCount < OTP_LENGTH}
                  style={[
                    s.filledButton,
                    (filledCount < OTP_LENGTH || verifying) && s.filledButtonDisabled
                  ]}
                >
                  {verifying ? (
                    <ActivityIndicator color={MD3.onPrimary} size="small" />
                  ) : (
                    <Text style={s.filledButtonText}>Verify</Text>
                  )}
                </TouchableOpacity>

                {/* Resend Action */}
                <View style={s.resendRow}>
                  <Text style={s.resendText}>Didn't receive the code?</Text>
                  <TouchableOpacity
                    onPress={handleResend}
                    style={s.textButton}
                    disabled={resending || resendCooldown > 0}
                  >
                    {resending ? (
                      <ActivityIndicator color={MD3.primary} size="small" />
                    ) : (
                      <Text style={[s.textButtonText, resendCooldown > 0 && s.textButtonDisabled]}>
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

              </View>
            </ScrollView>

            {/* Google MD3 Footer */}
            <View style={[s.footer, { marginBottom: Math.max(insets.bottom, 12) }]}>
              <View style={s.footerLinks}>
                <TouchableOpacity><Text style={s.footerLinkText}>English (United States)</Text></TouchableOpacity>
                <Ionicons name="chevron-down" size={14} color={MD3.onSurfaceVariant} />
              </View>
              <View style={s.footerLinks}>
                <TouchableOpacity><Text style={s.footerLinkText}>Help</Text></TouchableOpacity>
                <TouchableOpacity><Text style={s.footerLinkText}>Privacy</Text></TouchableOpacity>
                <TouchableOpacity><Text style={s.footerLinkText}>Terms</Text></TouchableOpacity>
              </View>
            </View>

          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: MD3.surface,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: MD3.surface,
    borderRadius: 28,
    borderWidth: Platform.OS === "web" ? 1 : 0,
    borderColor: MD3.outlineVariant,
    paddingVertical: 36,
    paddingHorizontal: 20,
    width: "100%",
    maxWidth: 450,
    alignSelf: "center",
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 32,
  },
  logo: {
    width: 110,
    height: 36,
    tintColor: MD3.primary,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: MD3.onSurface,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: MD3.onSurfaceVariant,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 20,
  },
  emailBadge: {
    fontSize: 15,
    fontWeight: "700",
    color: MD3.onSurface,
    marginTop: 4,
  },

  // 6 Digit OTP Layout
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginVertical: 12,
  },
  otpBox: {
    flex: 1,
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: MD3.outline,
    backgroundColor: MD3.surface,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "700",
    color: MD3.onSurface,
  },
  otpBoxFocused: {
    borderColor: MD3.primary,
    borderWidth: 2,
  },
  otpBoxFilled: {
    borderColor: MD3.primary,
  },
  otpBoxError: {
    borderColor: MD3.error,
  },

  // Labels
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    justifyContent: "center",
  },
  errorText: {
    color: MD3.error,
    fontSize: 13,
    fontWeight: "500",
  },
  hintText: {
    color: MD3.onSurfaceVariant,
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },

  // MD3 Button
  filledButton: {
    backgroundColor: MD3.primary,
    borderRadius: 100,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  filledButtonDisabled: {
    backgroundColor: MD3.surfaceVariant,
    opacity: 0.8,
  },
  filledButtonText: {
    color: MD3.onPrimary,
    fontSize: 14,
    fontWeight: "700",
  },

  resendRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    marginTop: 24,
  },
  resendText: {
    fontSize: 13,
    color: MD3.onSurfaceVariant,
  },
  textButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  textButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: MD3.primary,
  },
  textButtonDisabled: {
    color: MD3.onSurfaceVariant,
    fontWeight: "500",
  },

  // Footer Styling
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "auto",
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  footerLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  footerLinkText: {
    fontSize: 12,
    color: MD3.onSurfaceVariant,
  },
});
