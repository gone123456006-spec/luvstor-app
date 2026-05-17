import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

const OTP_LENGTH = 6;

export default function OtpScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError] = useState("");
  const inputs = useRef<(TextInput | null)[]>([]);

  const handleChange = (text: string, index: number) => {
    if (error) setError("");
    const digit = text.replace(/[^0-9]/g, "");
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

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

  const handleVerify = () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH) {
      setError("Please enter the full 6-digit code");
      return;
    }
    setError("");
    console.log("OTP Verified:", code, "for email:", email);
    // Navigate to Create Profile page
    router.replace("/create-profile" as any);
  };

  const handleResend = () => {
    setOtp(Array(OTP_LENGTH).fill(""));
    setError("");
    inputs.current[0]?.focus();
    console.log("Resend OTP to:", email);
  };

  const filledCount = otp.filter((d) => d !== "").length;

  return (
    <LinearGradient
      colors={["#1A0533", "#3B0764", "#6B21A8", "#7C3AED"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          bounces={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topSection}>
            <Animated.Text
              entering={FadeInUp.duration(800).springify()}
              style={styles.heading}
            >
              Verify Your Email
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.duration(800).delay(200).springify()}
              style={styles.subheading}
            >
              We sent a 6-digit code to
            </Animated.Text>
            <Animated.Text
              entering={FadeInDown.duration(800).delay(300).springify()}
              style={styles.emailText}
            >
              {email || "your email"}
            </Animated.Text>
          </View>

          <Animated.View
            entering={FadeInDown.duration(900).delay(400).springify()}
            style={styles.bottomCard}
          >
            <Text style={styles.cardTitle}>Enter OTP</Text>

            <View style={styles.otpRow}>
              {otp.map((digit, index) => (
                <TextInput
                  key={index}
                  ref={(ref) => {
                    inputs.current[index] = ref;
                  }}
                  style={[
                    styles.otpBox,
                    digit ? styles.otpBoxFilled : null,
                    error ? styles.otpBoxError : null,
                  ]}
                  value={digit}
                  onChangeText={(text) => handleChange(text, index)}
                  onKeyPress={(e) => handleKeyPress(e, index)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                />
              ))}
            </View>

            {error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <Text style={styles.hintText}>
                Enter the code sent to your Gmail
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.verifyBtn,
                filledCount < OTP_LENGTH && styles.verifyBtnDisabled,
              ]}
              activeOpacity={0.8}
              onPress={handleVerify}
            >
              <Text style={styles.verifyBtnText}>Verify</Text>
            </TouchableOpacity>

            <View style={styles.resendRow}>
              <Text style={styles.resendText}>Didn't receive the code? </Text>
              <TouchableOpacity onPress={handleResend}>
                <Text style={styles.resendLink}>Resend</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topSection: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 12,
  },
  subheading: {
    fontSize: 15,
    color: "rgba(255,255,255,0.7)",
  },
  emailText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 4,
  },

  bottomCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 40,
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1A1A2E",
    marginBottom: 24,
  },

  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  otpBox: {
    width: 48,
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E0E0E8",
    backgroundColor: "#F5F5FA",
    textAlign: "center",
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1A2E",
  },
  otpBoxFilled: {
    borderColor: "#7C3AED",
    backgroundColor: "#F5F0FF",
  },
  otpBoxError: {
    borderColor: "#EF4444",
    backgroundColor: "#FFF5F5",
  },

  errorText: {
    color: "#EF4444",
    fontSize: 12,
    marginTop: 8,
    marginBottom: 20,
    textAlign: "center",
  },
  hintText: {
    color: "#9A9AAE",
    fontSize: 12,
    marginTop: 8,
    marginBottom: 20,
    textAlign: "center",
  },

  verifyBtn: {
    backgroundColor: "#7C3AED",
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  verifyBtnDisabled: {
    opacity: 0.6,
  },
  verifyBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  resendRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  resendText: {
    fontSize: 13,
    color: "#9A9AAE",
  },
  resendLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7C3AED",
  },
});
