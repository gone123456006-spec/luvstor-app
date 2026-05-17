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
} from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

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
            backgroundColor: "rgba(255,255,255,0.5)",
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
      style={[styles.tag, style]}
    >
      <Text style={styles.tagEmoji}>{emoji}</Text>
      <Text style={styles.tagLabel}>{label}</Text>
    </Animated.View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <LinearGradient
      colors={["#1A0533", "#3B0764", "#6B21A8", "#7C3AED"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      {/* Top section with blobs */}
      <View style={styles.topSection}>
        <Animated.View 
          entering={FadeInUp.duration(800).delay(100).springify()}
          style={styles.logoContainer}
        >
          <Image 
            source={require("../assets/images/luvstoer logo.png")} 
            style={styles.logo} 
            contentFit="contain" 
          />
        </Animated.View>
        
        {/* Blob area */}
        <View style={styles.blobArea}>
          {/* Right blob - Boy (behind) */}
          <Animated.View
            entering={FadeInUp.duration(900).delay(200).springify()}
            style={styles.rightBlob}
          >
            <View style={styles.dotPatternContainer}>
              <DotPattern />
            </View>
            <Image
              source={require("../assets/images/boy-image.png")}
              style={styles.blobImage}
              contentFit="cover"
            />
          </Animated.View>

          {/* Left blob - Girl (in front) */}
          <Animated.View
            entering={FadeInUp.duration(900).delay(350).springify()}
            style={styles.leftBlob}
          >
            <Image
              source={require("../assets/images/girls-image.png")}
              style={styles.blobImage}
              contentFit="cover"
            />
          </Animated.View>

          {/* Tags */}
          <Tag emoji="🤝" label="Friends" style={styles.friendsTag} />
          <Tag emoji="🎉" label="Short-term Fun" style={styles.funTag} />
          <Tag emoji="❤️" label="Relationship" style={styles.relationshipTag} />
          <Tag emoji="💬" label="Chats" style={styles.chatsTag} />
        </View>
      </View>

      {/* Bottom card */}
      <Animated.View
        entering={FadeInDown.duration(900).delay(400).springify()}
        style={styles.bottomCard}
      >
        <Text style={styles.title}>
          Your ideal match, Your{"\n"}ideal relationship.
        </Text>
        <Text style={styles.subtitle}>
          Create a unique emotional story that{"\n"}describes better than words
        </Text>

        <TouchableOpacity
          style={styles.getStartedBtn}
          activeOpacity={0.8}
          onPress={() => router.push("/login")}
        >
          <Text style={styles.getStartedText}>Get Started</Text>
          <View style={styles.arrowCircle}>
            <Text style={styles.arrowText}>›</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </LinearGradient>
  );
}

const BLOB_AREA_HEIGHT = height * 0.48;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topSection: {
    flex: 1,
    paddingTop: 60,
    justifyContent: "center",
    alignItems: "center",
  },
  blobArea: {
    width: width * 0.85,
    height: BLOB_AREA_HEIGHT,
    position: "relative",
  },

  // Left blob
  leftBlob: {
    position: "absolute",
    width: width * 0.52,
    height: BLOB_AREA_HEIGHT * 0.88,
    left: 0,
    top: 0,
    backgroundColor: "rgba(192, 160, 255, 0.45)",
    borderTopLeftRadius: 120,
    borderTopRightRadius: 80,
    borderBottomLeftRadius: 60,
    borderBottomRightRadius: 130,
    overflow: "hidden",
    transform: [{ rotate: "-3deg" }],
    zIndex: 2,
  },
  blobImage: {
    width: "100%",
    height: "100%",
  },

  // Right blob
  rightBlob: {
    position: "absolute",
    width: width * 0.45,
    height: BLOB_AREA_HEIGHT * 0.7,
    right: -10,
    top: BLOB_AREA_HEIGHT * 0.12,
    backgroundColor: "rgba(192, 160, 255, 0.40)",
    borderTopLeftRadius: 80,
    borderTopRightRadius: 110,
    borderBottomLeftRadius: 120,
    borderBottomRightRadius: 70,
    overflow: "hidden",
    transform: [{ rotate: "4deg" }],
    zIndex: 1,
  },
  dotPatternContainer: {
    position: "absolute",
    top: 15,
    right: 15,
    zIndex: 1,
  },

  // Tags
  tag: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 10,
  },
  tagEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  tagLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2C3E50",
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

  // Bottom card
  bottomCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 30,
    paddingTop: 35,
    paddingBottom: 45,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1A1A2E",
    lineHeight: 32,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#7A7A8E",
    lineHeight: 21,
    marginBottom: 28,
  },
  getStartedBtn: {
    backgroundColor: "#F5D547",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 30,
  },
  getStartedText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A1A2E",
  },
  arrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: {
    fontSize: 22,
    fontWeight: "600",
    color: "#1A1A2E",
    marginTop: -2,
  },
  logoContainer: {
    marginBottom: 20,
    alignItems: 'center',
  },
  logo: {
    width: 150,
    height: 50,
  },
});
