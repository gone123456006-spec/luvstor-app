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
          <Text style={styles.updated}>Last updated: {new Date().toLocaleDateString()}</Text>

          <Text style={styles.sectionTitle}>Your Right to Delete</Text>
          <Text style={styles.paragraph}>
            At Luvstor, we believe you have full control over your data. You can permanently delete your account at any time through the app settings.
          </Text>

          <Text style={styles.sectionTitle}>How to Delete Your Account</Text>
          <Text style={styles.paragraph}>
            To delete your Luvstor account:
          </Text>
          <Text style={styles.bulletItem}>1. Open the Luvstor app</Text>
          <Text style={styles.bulletItem}>2. Go to Profile → Settings</Text>
          <Text style={styles.bulletItem}>3. Tap on "Account"</Text>
          <Text style={styles.bulletItem}>4. Scroll down and tap "Delete account"</Text>
          <Text style={styles.bulletItem}>5. Follow the on-screen confirmation steps</Text>

          <Text style={styles.sectionTitle}>What Gets Deleted</Text>
          <Text style={styles.paragraph}>
            When you delete your account, the following data is permanently removed:
          </Text>
          <Text style={styles.bulletItem}>• Your profile information (name, photos, bio)</Text>
          <Text style={styles.bulletItem}>• Your matches and likes</Text>
          <Text style={styles.bulletItem}>• Your messages and chat history</Text>
          <Text style={styles.bulletItem}>• Your voice messages and media</Text>
          <Text style={styles.bulletItem}>• Your location data and preferences</Text>
          <Text style={styles.bulletItem}>• Your subscription details (active subscriptions are cancelled)</Text>

          <Text style={styles.sectionTitle}>What Happens Immediately</Text>
          <Text style={styles.paragraph}>
            Once you confirm account deletion:
          </Text>
          <Text style={styles.bulletItem}>• You will be logged out immediately</Text>
          <Text style={styles.bulletItem}>• Your profile will no longer be visible to other users</Text>
          <Text style={styles.bulletItem}>• You will no longer appear in matches or search results</Text>
          <Text style={styles.bulletItem}>• Other users' conversations with you will show that you deleted your account</Text>

          <Text style={styles.sectionTitle}>Data Retention Period</Text>
          <Text style={styles.paragraph}>
            Your data is deleted within 30 days of account deletion. During this period:
          </Text>
          <Text style={styles.bulletItem}>• Your account is deactivated and hidden from all users</Text>
          <Text style={styles.bulletItem}>• You can reactivate your account by logging in again (within 30 days only)</Text>
          <Text style={styles.bulletItem}>• After 30 days, deletion is permanent and cannot be reversed</Text>

          <Text style={styles.sectionTitle}>Legal and Safety Retention</Text>
          <Text style={styles.paragraph}>
            We may retain certain data for legal, security, or safety purposes:
          </Text>
          <Text style={styles.bulletItem}>• Transaction records (for accounting and tax compliance)</Text>
          <Text style={styles.bulletItem}>• Content subject to legal investigations or disputes</Text>
          <Text style={styles.bulletItem}>• Data necessary to prevent fraud or abuse</Text>
          <Text style={styles.bulletItem}>• Anonymized analytics data (without personal identifiers)</Text>

          <Text style={styles.sectionTitle}>Active Subscriptions</Text>
          <Text style={styles.paragraph}>
            If you have an active paid subscription:
          </Text>
          <Text style={styles.bulletItem}>• Your subscription will be cancelled immediately</Text>
          <Text style={styles.bulletItem}>• No refund for unused subscription time (per our Refund Policy)</Text>
          <Text style={styles.bulletItem}>• Auto-renewal will be stopped</Text>
          <Text style={styles.bulletItem}>• You can cancel subscription separately before deleting if preferred</Text>

          <Text style={styles.sectionTitle}>Before You Delete</Text>
          <Text style={styles.paragraph}>
            Consider these alternatives to permanent deletion:
          </Text>
          <Text style={styles.bulletItem}>• Temporarily hide your profile (coming soon)</Text>
          <Text style={styles.bulletItem}>• Adjust privacy settings to limit who can find you</Text>
          <Text style={styles.bulletItem}>• Block specific users instead of leaving entirely</Text>
          <Text style={styles.bulletItem}>• Contact support if you're experiencing issues</Text>

          <Text style={styles.sectionTitle}>Cannot Delete?</Text>
          <Text style={styles.paragraph}>
            If you're unable to delete your account through the app, you can request deletion by contacting us at support@luvstor.com. We will process your request within 7 business days.
          </Text>

          <Text style={styles.sectionTitle}>After Deletion</Text>
          <Text style={styles.paragraph}>
            You can create a new Luvstor account at any time using the same or different email address. Your new account will be completely separate from your deleted account - no data will be carried over.
          </Text>

          <Text style={styles.sectionTitle}>Questions or Concerns</Text>
          <Text style={styles.paragraph}>
            If you have questions about account deletion or data removal:
          </Text>
          <Text style={styles.bulletItem}>• Email: support@luvstor.com</Text>
          <Text style={styles.bulletItem}>• In-App: Settings → Help & Support</Text>
          <Text style={styles.bulletItem}>• We typically respond within 48 hours</Text>
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
