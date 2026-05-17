import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

const { width } = Dimensions.get("window");

const GMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = () => {
    if (!email.trim()) {
      setError("Please enter your Gmail address");
      return;
    }
    if (!GMAIL_REGEX.test(email.trim())) {
      setError("Please enter a valid Gmail address (e.g. name@gmail.com)");
      return;
    }
    setError("");
    router.push(`/otp?email=${encodeURIComponent(email.trim())}` as any);
  };

  const handleChange = (text: string) => {
    setEmail(text);
    if (error) setError("");
  };

  return (
    <LinearGradient
      colors={["#1A0533", "#3B0764", "#6B21A8", "#7C3AED"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.topSection}>
          <Animated.View
            entering={FadeInUp.duration(800).springify()}
            style={styles.logoContainer}
          >
            <Image
              source={require("../assets/images/luvstoer logo.png")}
              style={styles.logo}
              contentFit="contain"
            />
          </Animated.View>

          <Animated.Text
            entering={FadeInDown.duration(800).delay(200).springify()}
            style={styles.heading}
          >
            Welcome Back
          </Animated.Text>
        </View>

        <Animated.View
          entering={FadeInDown.duration(900).delay(400).springify()}
          style={styles.bottomCard}
        >
          <Text style={styles.cardTitle}>Sign In</Text>
          <Text style={styles.cardSubtitle}>
            Enter your Gmail account to continue
          </Text>

          <View style={styles.inputWrapper}>
            <View style={styles.inputIconContainer}>
              <Text style={styles.inputIcon}>✉</Text>
            </View>
            <TextInput
              style={[
                styles.input,
                focused && styles.inputFocused,
                error ? styles.inputError : null,
              ]}
              placeholder="yourname@gmail.com"
              placeholderTextColor="#A0A0B0"
              value={email}
              onChangeText={handleChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </View>

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <Text style={styles.hintText}>Only @gmail.com accounts are accepted</Text>
          )}

          <TouchableOpacity
            style={[
              styles.submitBtn,
              !email.trim() && styles.submitBtnDisabled,
            ]}
            activeOpacity={0.8}
            onPress={handleSubmit}
          >
            <Text style={styles.submitBtnText}>Submit</Text>
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              By continuing, you agree to our{" "}
            </Text>
            <TouchableOpacity>
              <Text style={styles.linkText}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.footerText}> & </Text>
            <TouchableOpacity>
              <Text style={styles.linkText}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
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
  logoContainer: {
    marginBottom: 24,
  },
  logo: {
    width: 180,
    height: 50,
  },
  heading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 8,
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
    marginBottom: 6,
  },
  cardSubtitle: {
    fontSize: 14,
    color: "#7A7A8E",
    marginBottom: 24,
  },

  inputWrapper: {
    position: "relative",
  },
  inputIconContainer: {
    position: "absolute",
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    zIndex: 1,
  },
  inputIcon: {
    fontSize: 18,
  },
  input: {
    backgroundColor: "#F5F5FA",
    borderWidth: 1.5,
    borderColor: "#E0E0E8",
    borderRadius: 28,
    paddingVertical: 15,
    paddingHorizontal: 20,
    paddingLeft: 48,
    fontSize: 15,
    color: "#1A1A2E",
  },
  inputFocused: {
    borderColor: "#7C3AED",
    backgroundColor: "#FAFAFF",
  },
  inputError: {
    borderColor: "#EF4444",
    backgroundColor: "#FFF5F5",
  },

  errorText: {
    color: "#EF4444",
    fontSize: 12,
    marginTop: 8,
    marginLeft: 16,
    marginBottom: 20,
  },
  hintText: {
    color: "#9A9AAE",
    fontSize: 12,
    marginTop: 8,
    marginLeft: 16,
    marginBottom: 20,
  },

  submitBtn: {
    backgroundColor: "#7C3AED",
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  footerText: {
    fontSize: 12,
    color: "#9A9AAE",
  },
  linkText: {
    fontSize: 12,
    color: "#7C3AED",
    fontWeight: "600",
  },
});
