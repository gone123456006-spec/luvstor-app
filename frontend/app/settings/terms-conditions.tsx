import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const C = {
  bg: '#F5F5F7',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  primary: '#370372',
  header: '#F5F5F7',
};

export default function TermsConditionsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={C.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms & Conditions</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.content}>
          <Text style={styles.updated}>Last updated: {new Date().toLocaleDateString()}</Text>

          <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
          <Text style={styles.paragraph}>
            By accessing or using Luvstor ("the App"), you agree to be bound by these Terms and Conditions. If you do not agree to these terms, please do not use the App.
          </Text>

          <Text style={styles.sectionTitle}>2. Eligibility</Text>
          <Text style={styles.paragraph}>
            You must be at least 18 years old to use Luvstor. By creating an account, you represent and warrant that:
          </Text>
          <Text style={styles.bulletItem}>• You are at least 18 years of age</Text>
          <Text style={styles.bulletItem}>• You have the right, authority, and capacity to enter into these terms</Text>
          <Text style={styles.bulletItem}>• You will comply with all applicable laws and regulations</Text>

          <Text style={styles.sectionTitle}>3. Account Registration</Text>
          <Text style={styles.paragraph}>
            To use Luvstor, you must create an account. You agree to:
          </Text>
          <Text style={styles.bulletItem}>• Provide accurate, current, and complete information</Text>
          <Text style={styles.bulletItem}>• Maintain the security of your account credentials</Text>
          <Text style={styles.bulletItem}>• Notify us immediately of any unauthorized use</Text>
          <Text style={styles.bulletItem}>• Accept responsibility for all activities under your account</Text>

          <Text style={styles.sectionTitle}>4. User Conduct</Text>
          <Text style={styles.paragraph}>
            You agree NOT to:
          </Text>
          <Text style={styles.bulletItem}>• Harass, abuse, or harm other users</Text>
          <Text style={styles.bulletItem}>• Post illegal, offensive, or inappropriate content</Text>
          <Text style={styles.bulletItem}>• Impersonate any person or entity</Text>
          <Text style={styles.bulletItem}>• Share others' private information without consent</Text>
          <Text style={styles.bulletItem}>• Engage in commercial solicitation or spam</Text>
          <Text style={styles.bulletItem}>• Use automated systems or bots</Text>
          <Text style={styles.bulletItem}>• Attempt to hack, disrupt, or reverse-engineer the App</Text>

          <Text style={styles.sectionTitle}>5. Content Ownership</Text>
          <Text style={styles.paragraph}>
            You retain ownership of content you post on Luvstor. By posting content, you grant us a worldwide, non-exclusive, royalty-free license to use, store, display, and distribute your content as necessary to provide our services.
          </Text>

          <Text style={styles.sectionTitle}>6. Content Moderation</Text>
          <Text style={styles.paragraph}>
            Luvstor reserves the right to review, remove, or moderate content that violates these Terms or our Community Guidelines. We may suspend or terminate accounts that repeatedly violate our policies.
          </Text>

          <Text style={styles.sectionTitle}>7. Subscription and Payments</Text>
          <Text style={styles.paragraph}>
            Luvstor offers premium subscriptions (Gold, Platinum, Black) with enhanced features. By purchasing a subscription:
          </Text>
          <Text style={styles.bulletItem}>• Payments are processed through third-party payment providers</Text>
          <Text style={styles.bulletItem}>• Subscriptions auto-renew unless cancelled</Text>
          <Text style={styles.bulletItem}>• Refunds are subject to our Refund Policy</Text>
          <Text style={styles.bulletItem}>• Prices may change with notice to existing subscribers</Text>

          <Text style={styles.sectionTitle}>8. Location Services</Text>
          <Text style={styles.paragraph}>
            Luvstor uses your device location to show nearby matches. Location accuracy depends on your device and settings. You can disable location access, but this may limit app functionality.
          </Text>

          <Text style={styles.sectionTitle}>9. Safety and Security</Text>
          <Text style={styles.paragraph}>
            While we implement security measures, you acknowledge that:
          </Text>
          <Text style={styles.bulletItem}>• Online interactions carry inherent risks</Text>
          <Text style={styles.bulletItem}>• You are responsible for your own safety</Text>
          <Text style={styles.bulletItem}>• We are not liable for offline interactions with other users</Text>
          <Text style={styles.bulletItem}>• You should report suspicious activity immediately</Text>

          <Text style={styles.sectionTitle}>10. Intellectual Property</Text>
          <Text style={styles.paragraph}>
            The Luvstor app, including its design, features, and content (excluding user-generated content), is owned by Luvstor and protected by intellectual property laws. You may not copy, modify, or distribute our intellectual property without permission.
          </Text>

          <Text style={styles.sectionTitle}>11. Disclaimer of Warranties</Text>
          <Text style={styles.paragraph}>
            Luvstor is provided "as is" without warranties of any kind. We do not guarantee that the app will be error-free, secure, or always available. Use at your own risk.
          </Text>

          <Text style={styles.sectionTitle}>12. Limitation of Liability</Text>
          <Text style={styles.paragraph}>
            To the fullest extent permitted by law, Luvstor shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the app.
          </Text>

          <Text style={styles.sectionTitle}>13. Account Termination</Text>
          <Text style={styles.paragraph}>
            You may delete your account at any time through Settings. We may suspend or terminate your account for violations of these Terms. Upon termination, your data will be deleted according to our Privacy Policy.
          </Text>

          <Text style={styles.sectionTitle}>14. Changes to Terms</Text>
          <Text style={styles.paragraph}>
            We may update these Terms from time to time. Continued use of the app after changes constitutes acceptance of the revised Terms.
          </Text>

          <Text style={styles.sectionTitle}>15. Governing Law</Text>
          <Text style={styles.paragraph}>
            These Terms are governed by applicable laws. Any disputes shall be resolved through appropriate legal channels.
          </Text>

          <Text style={styles.sectionTitle}>16. Contact</Text>
          <Text style={styles.paragraph}>
            For questions about these Terms, contact us at:
          </Text>
          <Text style={styles.bulletItem}>• Email: support@luvstor.com</Text>
          <Text style={styles.bulletItem}>• In-App: Settings → Help & Support</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: C.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFE8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: C.text },
  scroll: { paddingBottom: 40 },
  content: {
    backgroundColor: C.white,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  updated: {
    fontSize: 13,
    color: C.secondary,
    marginBottom: 24,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    marginTop: 24,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
    marginBottom: 12,
  },
  bulletItem: {
    fontSize: 15,
    color: C.text,
    lineHeight: 22,
    marginBottom: 8,
    paddingLeft: 8,
  },
});
