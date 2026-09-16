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

export default function PrivacyPolicyScreen() {
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
        <Text style={styles.headerTitle}>Privacy Policy</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.content}>
          <Text style={styles.updated}>Last updated: {new Date().toLocaleDateString()}</Text>

          <Text style={styles.sectionTitle}>1. Information We Collect</Text>
          <Text style={styles.paragraph}>
            Luvstor collects information you provide directly to us, including:
          </Text>
          <Text style={styles.bulletItem}>• Name, email address, and profile information</Text>
          <Text style={styles.bulletItem}>• Photos and videos you upload</Text>
          <Text style={styles.bulletItem}>• Messages, voice notes, and call data</Text>
          <Text style={styles.bulletItem}>• Location data (with your permission) to show nearby matches</Text>
          <Text style={styles.bulletItem}>• Device information and usage data</Text>

          <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
          <Text style={styles.paragraph}>
            We use the information we collect to:
          </Text>
          <Text style={styles.bulletItem}>• Provide, maintain, and improve our services</Text>
          <Text style={styles.bulletItem}>• Connect you with nearby matches based on your preferences</Text>
          <Text style={styles.bulletItem}>• Send you notifications about matches, messages, and app updates</Text>
          <Text style={styles.bulletItem}>• Verify your identity and prevent fraud</Text>
          <Text style={styles.bulletItem}>• Ensure safety and security on the platform</Text>

          <Text style={styles.sectionTitle}>3. Data Sharing and Disclosure</Text>
          <Text style={styles.paragraph}>
            We do not sell your personal data. We may share your information only in the following circumstances:
          </Text>
          <Text style={styles.bulletItem}>• With other users as part of the service (profile, photos, messages)</Text>
          <Text style={styles.bulletItem}>• With service providers who assist in operating our platform</Text>
          <Text style={styles.bulletItem}>• When required by law or to protect rights and safety</Text>
          <Text style={styles.bulletItem}>• With your consent for specific purposes</Text>

          <Text style={styles.sectionTitle}>4. Location Data</Text>
          <Text style={styles.paragraph}>
            Luvstor uses your location to show you nearby matches. You can control location access through your device settings. Disabling location may limit certain features like discovering nearby users.
          </Text>

          <Text style={styles.sectionTitle}>5. Photos and Media</Text>
          <Text style={styles.paragraph}>
            When you share photos or media in chats, we store them securely. Other users can view and download content you share with them. Be mindful of what you share.
          </Text>

          <Text style={styles.sectionTitle}>6. Voice and Video Calls</Text>
          <Text style={styles.paragraph}>
            Luvstor uses your device's microphone and camera for voice messages and video/audio calls. We do not record or store call content. Call metadata (duration, participants) may be retained for service quality.
          </Text>

          <Text style={styles.sectionTitle}>7. Push Notifications</Text>
          <Text style={styles.paragraph}>
            We send push notifications for new messages, matches, and important updates. You can manage notification preferences in your device settings or within the app.
          </Text>

          <Text style={styles.sectionTitle}>8. Data Security</Text>
          <Text style={styles.paragraph}>
            We implement industry-standard security measures to protect your data, including encryption of sensitive information. However, no method of transmission over the internet is 100% secure.
          </Text>

          <Text style={styles.sectionTitle}>9. Data Retention</Text>
          <Text style={styles.paragraph}>
            We retain your data for as long as your account is active or as needed to provide services. You can request deletion of your account and data at any time through Account Settings.
          </Text>

          <Text style={styles.sectionTitle}>10. Your Rights</Text>
          <Text style={styles.paragraph}>
            You have the right to:
          </Text>
          <Text style={styles.bulletItem}>• Access, update, or delete your personal information</Text>
          <Text style={styles.bulletItem}>• Control location and notification permissions</Text>
          <Text style={styles.bulletItem}>• Request a copy of your data</Text>
          <Text style={styles.bulletItem}>• Delete your account permanently</Text>

          <Text style={styles.sectionTitle}>11. Children's Privacy</Text>
          <Text style={styles.paragraph}>
            Luvstor is not intended for users under 18 years of age. We do not knowingly collect information from children. If you believe a child has provided us with personal information, please contact us.
          </Text>

          <Text style={styles.sectionTitle}>12. Changes to This Policy</Text>
          <Text style={styles.paragraph}>
            We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or via email.
          </Text>

          <Text style={styles.sectionTitle}>13. Contact Us</Text>
          <Text style={styles.paragraph}>
            If you have questions about this Privacy Policy, please contact us at:
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
