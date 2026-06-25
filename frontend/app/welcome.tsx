import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

const { width, height } = Dimensions.get("window");

// ── Design Tokens ──────────────────────────────────────────
const C = {
  primary: "#7C3AED",          // Brand Purple/Violet
  primaryContainer: "#F5F0FF",
  surface: "#FFFFFF",          // Bottom Card White
  onSurface: "#1A1A2E",
  onSurfaceVariant: "#7A7A8E",
  outline: "#CAC4D0",
};

function DotPattern() {
  const dots = [];
  const rows = 6;
  const cols = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dots.push(
        <View
          key={`${r}-${c}`}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: "rgba(255,255,255,0.4)",
            position: "absolute",
            top: r * 12,
            left: c * 12,
          }}
        />,
      );
    }
  }
  return <View style={{ width: cols * 12, height: rows * 12 }}>{dots}</View>;
}

function Tag({
  emoji,
  label,
  style,
}: {
  emoji: string;
  label: string;
  style?: object;
}) {
  return (
    <Animated.View
      entering={FadeInUp.duration(700).delay(600).springify()}
      style={[s.tag, style]}
    >
      <Text style={s.tagEmoji}>{emoji}</Text>
      <Text style={s.tagLabel}>{label}</Text>
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1A0533" />
      
      {/* Premium Original Gradient Background */}
      <LinearGradient
        colors={["#1A0533", "#3B0764", "#6B21A8", "#7C3AED"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

        <View style={s.mainContainer}>
          
          {/* Top section with blobs */}
          <View style={[s.topSection, { paddingTop: Math.max(insets.top, 20) }]}>
            <Animated.View 
              entering={FadeInUp.duration(800).delay(100).springify()}
              style={s.logoContainer}
            >
              <Image 
                source={require("../assets/images/luvstoer logo.png")} 
                style={[s.logo, { tintColor: "#EADDFF" }]} 
                contentFit="contain" 
              />
            </Animated.View>
            
            {/* Blob area */}
            <View style={s.blobArea}>
              {/* Right blob - Boy (behind) */}
              <Animated.View
                entering={FadeInUp.duration(900).delay(200).springify()}
                style={s.rightBlobOuter}
              >
                <View style={s.rightBlob}>
                  <View style={s.dotPatternContainer}>
                    <DotPattern />
                  </View>
                  <Image
                    source={require("../assets/images/boy-image.png")}
                    style={s.blobImage}
                    contentFit="cover"
                  />
                </View>
              </Animated.View>

              {/* Left blob - Girl (in front) */}
              <Animated.View
                entering={FadeInUp.duration(900).delay(350).springify()}
                style={s.leftBlobOuter}
              >
                <View style={s.leftBlob}>
                  <Image
                    source={require("../assets/images/girls-image.png")}
                    style={s.blobImage}
                    contentFit="cover"
                  />
                </View>
              </Animated.View>

              {/* MD3-Styled Assist Chips (Tags) */}
              <Tag emoji="🤝" label="Friends" style={s.friendsTag} />
              <Tag emoji="🎉" label="Short-term Fun" style={s.funTag} />
              <Tag emoji="❤️" label="Relationship" style={s.relationshipTag} />
              <Tag emoji="💬" label="Chats" style={s.chatsTag} />
            </View>
          </View>

          {/* Bottom Card (Google Material 3 design spec) */}
          <Animated.View
            entering={FadeInDown.duration(900).delay(400).springify()}
            style={[s.bottomCard, { paddingBottom: Math.max(insets.bottom, 24) }]}
          >
            <Text style={s.title}>
              Your ideal match,{"\n"}Your ideal relationship.
            </Text>
            <Text style={s.subtitle}>
              Create a unique emotional story that{"\n"}describes you better than words.
            </Text>

            {/* Google MD3 Premium Capsule Action Button */}
            <TouchableOpacity
              style={s.getStartedBtn}
              activeOpacity={0.8}
              onPress={() => router.push("/login")}
            >
              <Text style={s.getStartedText}>Get Started</Text>
              <View style={s.arrowCircle}>
                <Ionicons name="arrow-forward" size={18} color="#1A1A2E" />
              </View>
            </TouchableOpacity>
          </Animated.View>
          
        </View>
    </View>
  );
}

const BLOB_AREA_HEIGHT = height * 0.46;

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  mainContainer: {
    flex: 1,
    justifyContent: "space-between",
  },
  topSection: {
    flex: 1,
    paddingTop: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  logoContainer: {
    marginBottom: 16,
    alignItems: "center",
  },
  logo: {
    width: 150,
    height: 48,
  },
  blobArea: {
    width: width * 0.85,
    height: BLOB_AREA_HEIGHT,
    position: "relative",
  },

  // Left blob (Girl image) — outer = layout animation, inner = transform
  leftBlobOuter: {
    position: "absolute",
    width: width * 0.52,
    height: BLOB_AREA_HEIGHT * 0.88,
    left: 0,
    top: 0,
    zIndex: 2,
  },
  leftBlob: {
    flex: 1,
    backgroundColor: "rgba(192, 160, 255, 0.35)",
    borderTopLeftRadius: 120,
    borderTopRightRadius: 80,
    borderBottomLeftRadius: 60,
    borderBottomRightRadius: 130,
    overflow: "hidden",
    transform: [{ rotate: "-3deg" }],
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
  },
  blobImage: {
    width: "100%",
    height: "100%",
  },

  // Right blob (Boy image)
  rightBlobOuter: {
    position: "absolute",
    width: width * 0.45,
    height: BLOB_AREA_HEIGHT * 0.7,
    right: -10,
    top: BLOB_AREA_HEIGHT * 0.12,
    zIndex: 1,
  },
  rightBlob: {
    flex: 1,
    backgroundColor: "rgba(192, 160, 255, 0.30)",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 110,
    borderBottomLeftRadius: 120,
    borderBottomRightRadius: 70,
    overflow: "hidden",
    transform: [{ rotate: "4deg" }],
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.15)",
  },
  dotPatternContainer: {
    position: "absolute",
    top: 15,
    right: 15,
    zIndex: 1,
  },

  // Material 3 Styled Tags (Assist Chips)
  tag: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100, // Fully-rounded pill shape
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  tagEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  tagLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2C3E50",
    letterSpacing: 0.1,
  },
  friendsTag: {
    top: BLOB_AREA_HEIGHT * 0.08,
    left: -5,
  },
  funTag: {
    top: BLOB_AREA_HEIGHT * 0.05,
    right: -5,
  },
  relationshipTag: {
    top: BLOB_AREA_HEIGHT * 0.52,
    left: width * 0.22,
  },
  chatsTag: {
    bottom: BLOB_AREA_HEIGHT * 0.02,
    right: 5,
  },

  // Sliding Bottom Card (Material 3 styled)
  bottomCard: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: C.onSurface,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: C.onSurfaceVariant,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 32,
  },

  // Google MD3 Premium Capsule Buttons
  getStartedBtn: {
    backgroundColor: "#F5D547",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 100, // Capsule shape
    shadowColor: "#F5D547",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  getStartedText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1A1A2E",
    letterSpacing: 0.2,
  },
  arrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
});
