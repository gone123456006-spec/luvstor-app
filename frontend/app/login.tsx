import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiSendOTP } from "../utils/api";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const C = {
  primary: "#7C3AED",
  primaryContainer: "#F5F0FF",
  surface: "#FFFFFF",
  onSurface: "#1A1A2E",
  onSurfaceVariant: "#7A7A8E",
  outline: "#CAC4D0",
  error: "#EF4444",
};

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  const labelAnim = useRef(new Animated.Value(email ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(labelAnim, {
      toValue: focused || email ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [focused, email]);

  const labelStyle = {
    top: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [16, -10] }),
    fontSize: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 12] }),
    color: labelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [C.onSurfaceVariant, error ? C.error : C.primary],
    }),
    backgroundColor: focused || email ? C.surface : "transparent",
  };

  const handleSubmit = async () => {
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
    setLoading(true);
    Keyboard.dismiss();

    try {
      const result = await apiSendOTP(trimmed);
      const cooldown = result.resendCooldownSeconds ?? 60;
      router.push(
        `/otp?email=${encodeURIComponent(trimmed)}&cooldown=${cooldown}` as any
      );
    } catch (err: any) {
      setError(err.message || "Could not send OTP. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (text: string) => {
    setEmail(text);
    if (error) setError("");
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={s.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1A0533" />

        <LinearGradient
          colors={["#1A0533", "#3B0764", "#6B21A8", "#7C3AED"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <KeyboardAvoidingView
          style={s.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Top Half: Brand & Header */}
            <View style={[s.topSection, { paddingTop: Math.max(insets.top, 20) }]}>
              <View style={s.logoContainer}>
                <Image
                  source={require("../assets/images/luvstoer logo.png")}
                  style={[s.logo, { tintColor: "#EADDFF" }]}
                  contentFit="contain"
                />
              </View>
              <Text style={s.heading}>Welcome Back</Text>
            </View>

            {/* Bottom Card */}
            <View style={[s.bottomCard, { paddingBottom: Math.max(insets.bottom, 24) }]}>
              <Text style={s.cardTitle}>Sign In</Text>
              <Text style={s.cardSubtitle}>
                Enter your email to receive a verification code
              </Text>

              {/* Floating Label Input */}
              <View style={s.inputContainer}>
                <View style={[s.inputBox, focused && s.inputBoxFocused, error ? s.inputBoxError : null]}>
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={error ? C.error : focused ? C.primary : C.onSurfaceVariant}
                  />
                  <TextInput
                    style={s.textInput}
                    value={email}
                    onChangeText={handleChange}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={focused ? "you@example.com" : ""}
                    placeholderTextColor={C.outline}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    editable={!loading}
                  />
                </View>
                <Animated.Text style={[s.floatingLabel, labelStyle]}>
                  Email address
                </Animated.Text>
              </View>

              {/* Error / Hint */}
              {error ? (
                <View style={s.errorRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={C.error} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : (
                <Text style={s.hintText}>
                  A 6-digit code will be sent to this email
                </Text>
              )}

              {/* Submit Button */}
              <TouchableOpacity
                onPress={handleSubmit}
                activeOpacity={0.8}
                disabled={loading || !email.trim()}
                style={[s.submitBtn, (!email.trim() || loading) && s.submitBtnDisabled]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.submitBtnText}>Send Code</Text>
                )}
              </TouchableOpacity>

              {/* Terms & Conditions */}
              <View style={s.footer}>
                <Text style={s.footerText}>By continuing, you agree to our </Text>
                <TouchableOpacity><Text style={s.linkText}>Terms of Service</Text></TouchableOpacity>
                <Text style={s.footerText}> & </Text>
                <TouchableOpacity><Text style={s.linkText}>Privacy Policy</Text></TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: { flex: 1 },
  topSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
  },
  logoContainer: { marginBottom: 20 },
  logo: { width: 180, height: 50 },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  bottomCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.onSurface,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    fontSize: 14,
    color: C.onSurfaceVariant,
    marginTop: 6,
    marginBottom: 28,
  },
  inputContainer: { position: "relative", width: "100%" },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.outline,
    borderRadius: 8,
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
    backgroundColor: C.surface,
  },
  inputBoxFocused: { borderColor: C.primary, borderWidth: 2 },
  inputBoxError: { borderColor: C.error },
  textInput: { flex: 1, fontSize: 16, color: C.onSurface, paddingVertical: 10 },
  floatingLabel: {
    position: "absolute",
    left: 44,
    paddingHorizontal: 4,
    fontWeight: "500",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingLeft: 4,
  },
  errorText: { color: C.error, fontSize: 13, fontWeight: "500" },
  hintText: { color: C.onSurfaceVariant, fontSize: 12, marginTop: 8, paddingLeft: 4 },
  submitBtn: {
    backgroundColor: C.primary,
    borderRadius: 100,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 28,
    marginBottom: 24,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: C.outline,
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
  },
  footerText: { fontSize: 12, color: C.onSurfaceVariant },
  linkText: { fontSize: 12, color: C.primary, fontWeight: "700" },
});
