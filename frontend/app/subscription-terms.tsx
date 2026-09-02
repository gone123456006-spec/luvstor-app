import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SUBSCRIPTION_TERMS } from "../utils/subscriptionTerms";

/** Matches main Luvstor app theme (Settings / Help) */
const PAGE = {
  bg: "#FDF8FF",
  surface: "#FFFFFF",
  text: "#1C1B1F",
  secondary: "#49454F",
  border: "#E7E0EC",
  primary: "#6750A4",
};

function renderBody(body: string) {
  const lines = body.split("\n");
  return lines.map((raw, index) => {
    const line = raw.trim();
    if (!line) {
      return <View key={`sp-${index}`} style={styles.lineSpacer} />;
    }

    if (line.startsWith("•")) {
      const text = line.replace(/^•\s*/, "").trim();
      return (
        <View key={`b-${index}`} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{text}</Text>
        </View>
      );
    }

    return (
      <Text key={`t-${index}`} style={styles.sectionBody}>
        {line}
      </Text>
    );
  });
}

export default function SubscriptionTermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor={PAGE.bg} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={PAGE.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Terms & Conditions
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.title}>{SUBSCRIPTION_TERMS.title}</Text>
        <Text style={styles.effective}>
          Effective Date: {SUBSCRIPTION_TERMS.effectiveDate}
        </Text>
        <Text style={styles.intro}>{SUBSCRIPTION_TERMS.intro}</Text>

        {SUBSCRIPTION_TERMS.sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.sectionBodyWrap}>{renderBody(section.body)}</View>
          </View>
        ))}

        <Text style={styles.closing}>{SUBSCRIPTION_TERMS.closing}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: PAGE.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: PAGE.bg,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: PAGE.text,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: PAGE.text,
    lineHeight: 30,
    marginBottom: 8,
  },
  effective: {
    fontSize: 12,
    color: PAGE.primary,
    fontWeight: "600",
    letterSpacing: 0.2,
    marginBottom: 16,
    textTransform: "uppercase",
  },
  intro: {
    fontSize: 14,
    color: PAGE.secondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: PAGE.text,
    marginBottom: 8,
  },
  sectionBodyWrap: {
    gap: 6,
  },
  sectionBody: {
    fontSize: 14,
    color: PAGE.secondary,
    lineHeight: 22,
  },
  lineSpacer: {
    height: 6,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: 0,
  },
  bulletDot: {
    width: 16,
    fontSize: 14,
    lineHeight: 22,
    color: PAGE.primary,
    fontWeight: "700",
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    color: PAGE.secondary,
    lineHeight: 22,
  },
  closing: {
    fontSize: 14,
    color: PAGE.text,
    lineHeight: 22,
    fontWeight: "500",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PAGE.border,
  },
});
