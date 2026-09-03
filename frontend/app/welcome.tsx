import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import {
  Dimensions,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: W, height: H } = Dimensions.get("window");

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Full-bleed photo plane */}
      <View style={styles.hero}>
        <Animated.View
          entering={FadeIn.duration(900)}
          style={styles.heroCol}
        >
          <Image
            source={require("../assets/images/girls-image.png")}
            style={styles.heroImage}
            contentFit="cover"
          />
        </Animated.View>
        <Animated.View
          entering={FadeIn.duration(900).delay(120)}
          style={styles.heroCol}
        >
          <Image
            source={require("../assets/images/boy-image.png")}
            style={styles.heroImage}
            contentFit="cover"
          />
        </Animated.View>
        <View style={styles.heroDivider} />
      </View>

      <LinearGradient
        colors={[
          "rgba(0,0,0,0.35)",
          "rgba(0,0,0,0.15)",
          "rgba(0,0,0,0.55)",
          "rgba(0,0,0,0.92)",
        ]}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 16) + 12,
            paddingBottom: Math.max(insets.bottom, 20) + 8,
          },
        ]}
      >
        <Animated.View
          entering={FadeInDown.duration(700).delay(200)}
          style={styles.brandBlock}
        >
          <Image
            source={require("../assets/images/luvstoer logo.png")}
            style={styles.logo}
            contentFit="contain"
            tintColor="#FFFFFF"
          />
        </Animated.View>

        <View style={styles.bottomBlock}>
          <Animated.Text
            entering={FadeInUp.duration(650).delay(350)}
            style={styles.headline}
          >
            Find your people.
          </Animated.Text>
          <Animated.Text
            entering={FadeInUp.duration(650).delay(450)}
            style={styles.subhead}
          >
            Meet nearby. Chat freely. Start something real.
          </Animated.Text>

          <Animated.View entering={FadeInUp.duration(650).delay(550)}>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.88}
              onPress={() => router.push("/login")}
            >
              <Text style={styles.primaryBtnText}>Get started</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(650).delay(650)}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.7}
              onPress={() => router.push("/login")}
            >
              <Text style={styles.secondaryBtnText}>
                Already have an account?{" "}
                <Text style={styles.secondaryBtnLink}>Log in</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  hero: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  heroCol: {
    flex: 1,
    height: H,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroDivider: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: W / 2 - StyleSheet.hairlineWidth,
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
  },
  brandBlock: {
    alignItems: "center",
  },
  logo: {
    width: Math.min(188, W * 0.48),
    height: 56,
  },
  bottomBlock: {
    width: "100%",
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.8,
    lineHeight: 40,
    textAlign: "center",
    marginBottom: 10,
  },
  subhead: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 28,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: "#0095F6",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  secondaryBtn: {
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 6,
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "400",
  },
  secondaryBtnLink: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
