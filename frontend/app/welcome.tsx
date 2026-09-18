import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import {
  Dimensions,
  Image,
  ImageBackground,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width: W, height: H } = Dimensions.get("window");
const BRAND = "#370372";

const BG = require("../assets/images/explore-girl.png");

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" translucent />

      <ImageBackground
        source={BG}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        {/* Soft purple + black fade */}
        <View style={styles.purpleWash} pointerEvents="none" />
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.75)",
            "rgba(55,3,114,0.28)",
            "rgba(0,0,0,0.08)",
            "transparent",
          ]}
          locations={[0, 0.35, 0.7, 1]}
          style={styles.topFade}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[
            "transparent",
            "rgba(55,3,114,0.18)",
            "rgba(0,0,0,0.65)",
            "rgba(0,0,0,0.88)",
            "rgba(0,0,0,0.94)",
          ]}
          locations={[0, 0.22, 0.48, 0.72, 1]}
          style={styles.bottomFade}
          pointerEvents="none"
        />

        <View
          style={[
            styles.content,
            {
              paddingTop: Math.max(insets.top, 12) + 14,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
            },
          ]}
        >
          <View style={styles.brandBlock}>
            <Image
              source={require("../assets/images/luvstor-wordmark.png")}
              style={styles.logo}
              resizeMode="contain"
              tintColor="#FFFFFF"
            />
          </View>

          <View style={styles.bottomBlock}>
            <Text style={styles.headline}>Find your people.</Text>
            <Text style={styles.subhead}>
              Meet nearby. Chat freely. Start something real.
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.88}
              onPress={() => router.push("/login")}
            >
              <Text style={styles.primaryBtnText}>Get started</Text>
            </TouchableOpacity>

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
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a0a24",
  },
  bg: {
    flex: 1,
    width: W,
    height: H,
  },
  bgImage: {
    width: "100%",
    height: "100%",
  },
  purpleWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(55, 3, 114, 0.18)",
  },
  topFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: H * 0.36,
  },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: H * 0.58,
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    zIndex: 2,
  },
  brandBlock: {
    alignItems: "center",
  },
  logo: {
    width: Math.min(176, W * 0.48),
    height: 52,
  },
  bottomBlock: {
    width: "100%",
    alignItems: "center",
  },
  headline: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: -0.9,
    lineHeight: 42,
    textAlign: "center",
    marginBottom: 10,
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    ...Platform.select({
      android: { includeFontPadding: false },
      default: {},
    }),
  },
  subhead: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 26,
    paddingHorizontal: 6,
  },
  primaryBtn: {
    width: "100%",
    height: 52,
    borderRadius: 26,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  secondaryBtn: {
    marginTop: 18,
    alignItems: "center",
    paddingVertical: 6,
  },
  secondaryBtnText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    fontWeight: "400",
  },
  secondaryBtnLink: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
