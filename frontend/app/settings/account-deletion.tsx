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
  danger: '#FF4B6E',
  header: '#F5F5F7',
};

export default function AccountDeletionScreen() {
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
        <Text style={styles.headerTitle}>Account Deletion Policy</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.content}>
          <Text style={styles.updated}>Last updated: September 22, 2026</Text>

          <Text style={styles.sectionTitle}>Your Right to Delete</Text>
          <Text style={styles.paragraph}>
            You can deactivate and permanently delete your Luvstor account at
            any time. You stay in control of your data.
          </Text>

          <Text style={styles.sectionTitle}>How to Delete in the App</Text>
          <Text style={styles.bulletItem}>1. Open Luvstor</Text>
          <Text style={styles.bulletItem}>2. Go to Settings → Account</Text>
          <Text style={styles.bulletItem}>3. Tap Delete account</Text>
          <Text style={styles.bulletItem}>
            4. Confirm that you understand deletion is permanent after the grace
            period
          </Text>
          <Text style={styles.bulletItem}>5. Choose a reason (optional)</Text>
          <Text style={styles.bulletItem}>6. Complete the final confirmation</Text>

          <Text style={styles.sectionTitle}>What Happens Right Away</Text>
          <Text style={styles.paragraph}>
            When you confirm deletion:
          </Text>
          <Text style={styles.bulletItem}>• Your account is deactivated</Text>
          <Text style={styles.bulletItem}>
            • Your profile is hidden from other users
          </Text>
          <Text style={styles.bulletItem}>
            • You stop appearing in Nearby, search, and discovery
          </Text>
          <Text style={styles.bulletItem}>• You are logged out</Text>
          <Text style={styles.bulletItem}>
            • Permanent deletion is scheduled for 7 days later
          </Text>

          <Text style={styles.sectionTitle}>7-Day Grace Period</Text>
          <Text style={styles.paragraph}>
            You have 7 days to change your mind. During this time:
          </Text>
          <Text style={styles.bulletItem}>
            • Your account stays hidden from others
          </Text>
          <Text style={styles.bulletItem}>
            • You can restore your account by logging in again
          </Text>
          <Text style={styles.bulletItem}>
            • We may send a reminder before permanent deletion
          </Text>
          <Text style={styles.bulletItem}>
            • After 7 days, deletion becomes permanent and cannot be undone
          </Text>

          <Text style={styles.sectionTitle}>What Is Permanently Removed</Text>
          <Text style={styles.paragraph}>
            After the grace period ends, we permanently remove account data
            including:
          </Text>
          <Text style={styles.bulletItem}>
            • Profile information (name, bio, preferences)
          </Text>
          <Text style={styles.bulletItem}>
            • Photos, cover photo, and gallery media tied to your account
          </Text>
          <Text style={styles.bulletItem}>• Matches, likes, and friendship data</Text>
          <Text style={styles.bulletItem}>
            • Chats, text messages, images, and voice notes associated with your
            account
          </Text>
          <Text style={styles.bulletItem}>• Location and discovery history for your account</Text>
          <Text style={styles.bulletItem}>• Device push tokens for your account</Text>
          <Text style={styles.bulletItem}>
            • In-app notifications for your account
          </Text>

          <Text style={styles.sectionTitle}>What May Be Kept Briefly or Separately</Text>
          <Text style={styles.paragraph}>
            For legal, safety, accounting, or abuse-prevention reasons, we may
            retain limited information such as:
          </Text>
          <Text style={styles.bulletItem}>
            • Payment or transaction records required for accounting or tax
            rules
          </Text>
          <Text style={styles.bulletItem}>
            • Information needed for fraud, safety, or legal investigations
          </Text>
          <Text style={styles.bulletItem}>
            • Anonymized or aggregated data that no longer identifies you
          </Text>

          <Text style={styles.sectionTitle}>Premium & Purchases</Text>
          <Text style={styles.paragraph}>
            If you have Premium or token purchases:
          </Text>
          <Text style={styles.bulletItem}>
            • Benefits tied to your Luvstor account end when the account is
            deleted
          </Text>
          <Text style={styles.bulletItem}>
            • Refunds follow our subscription / refund terms
          </Text>
          <Text style={styles.bulletItem}>
            • If you bought through a store (for example Google Play), you may
            also need to manage that purchase in the store’s subscription
            settings
          </Text>

          <Text style={styles.sectionTitle}>Before You Delete</Text>
          <Text style={styles.bulletItem}>• Block specific people instead of leaving</Text>
          <Text style={styles.bulletItem}>• Adjust who can find or message you</Text>
          <Text style={styles.bulletItem}>
            • Contact Help & Support if you are facing a problem we can fix
          </Text>

          <Text style={styles.sectionTitle}>Request Deletion by Email</Text>
          <Text style={styles.paragraph}>
            If you cannot delete from the app, email support@luvstor.com from
            the address linked to your account. We aim to process verified
            requests within 7 business days.
          </Text>

          <Text style={styles.sectionTitle}>After Permanent Deletion</Text>
          <Text style={styles.paragraph}>
            You may create a new account later with the same or a different
            email. A new account does not restore old matches, chats, or media.
          </Text>

          <Text style={styles.sectionTitle}>Contact</Text>
          <Text style={styles.bulletItem}>• Email: support@luvstor.com</Text>
          <Text style={styles.bulletItem}>• In-app: Settings → Help & Support</Text>
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
