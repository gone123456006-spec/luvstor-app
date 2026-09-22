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
          <Text style={styles.updated}>Last updated: September 22, 2026</Text>

          <Text style={styles.paragraph}>
            Luvstor (“we”, “our”, or “us”) helps adults 18+ meet nearby, chat,
            and connect. This Privacy Policy explains what information we
            collect, how we use it, and the choices you have. By using Luvstor,
            you agree to this policy.
          </Text>

          <Text style={styles.sectionTitle}>1. Who Can Use Luvstor</Text>
          <Text style={styles.paragraph}>
            Luvstor is only for users aged 18 and older. We do not knowingly
            collect personal information from anyone under 18. If you believe a
            minor has created an account, contact us and we will take action.
          </Text>

          <Text style={styles.sectionTitle}>2. Information You Provide</Text>
          <Text style={styles.bulletItem}>
            • Account details — email address and login verification codes
          </Text>
          <Text style={styles.bulletItem}>
            • Profile — name, age, gender, bio, interests, photos, cover photo,
            and other details you choose to add
          </Text>
          <Text style={styles.bulletItem}>
            • Messages — text, photos, and voice notes you send to other users
          </Text>
          <Text style={styles.bulletItem}>
            • Optional Google sign-in details if you choose that login method
          </Text>
          <Text style={styles.bulletItem}>
            • Support messages and feedback you send us
          </Text>
          <Text style={styles.bulletItem}>
            • Payment-related details when you buy Premium or tokens (processed
            by our payment partner; we do not store full card numbers)
          </Text>

          <Text style={styles.sectionTitle}>3. Information Collected Automatically</Text>
          <Text style={styles.bulletItem}>
            • Approximate or precise location (only with your permission) to
            show people nearby
          </Text>
          <Text style={styles.bulletItem}>
            • Device information such as device type, OS, and a device
            identifier used to keep your session secure
          </Text>
          <Text style={styles.bulletItem}>
            • Push notification token so we can alert you about messages,
            calls, and important updates
          </Text>
          <Text style={styles.bulletItem}>
            • Basic usage and connection information needed to run chat, calls,
            and discovery reliably
          </Text>

          <Text style={styles.sectionTitle}>4. How We Use Your Information</Text>
          <Text style={styles.bulletItem}>• Create and manage your account</Text>
          <Text style={styles.bulletItem}>
            • Show nearby people and personalized discovery based on your
            preferences
          </Text>
          <Text style={styles.bulletItem}>
            • Deliver chat, voice notes, voice calls, and video calls
          </Text>
          <Text style={styles.bulletItem}>
            • Send notifications about messages, calls, likes, and account
            activity
          </Text>
          <Text style={styles.bulletItem}>
            • Process Premium and token purchases
          </Text>
          <Text style={styles.bulletItem}>
            • Keep the community safer (fraud, abuse, and spam prevention)
          </Text>
          <Text style={styles.bulletItem}>
            • Improve app quality and fix problems
          </Text>
          <Text style={styles.bulletItem}>
            • Communicate about account, security, and service updates
          </Text>

          <Text style={styles.sectionTitle}>5. Location</Text>
          <Text style={styles.paragraph}>
            With your permission, Luvstor uses your location to show nearby
            people and distances. You can turn location off in your device
            settings. Without location, nearby discovery may be limited or
            unavailable.
          </Text>

          <Text style={styles.sectionTitle}>6. Photos, Voice Notes & Media</Text>
          <Text style={styles.paragraph}>
            Profile photos, cover photos, gallery images, chat images, and
            voice notes are stored on our servers so they can be shown to you
            and to people you share them with. Content you send in chat can be
            seen by the people in that conversation. Please only share what you
            are comfortable sharing.
          </Text>

          <Text style={styles.sectionTitle}>7. Voice & Video Calls</Text>
          <Text style={styles.paragraph}>
            Calls use your microphone and (for video) your camera. We do not
            record or store the live call audio or video content. We may keep
            limited call details such as who called whom, call type, and timing
            so the service can work and be supported.
          </Text>

          <Text style={styles.sectionTitle}>8. Notifications</Text>
          <Text style={styles.paragraph}>
            If you allow notifications, we may send alerts for new messages,
            incoming calls, likes, matches, and important account notices. You
            can change notification permission in your device settings.
          </Text>

          <Text style={styles.sectionTitle}>9. How We Share Information</Text>
          <Text style={styles.paragraph}>
            We do not sell your personal information. We may share information:
          </Text>
          <Text style={styles.bulletItem}>
            • With other users, as part of normal use (your profile, photos you
            publish, messages you send them)
          </Text>
          <Text style={styles.bulletItem}>
            • With trusted service providers who help us run the app (for
            example hosting, email delivery, push delivery, and payments)
          </Text>
          <Text style={styles.bulletItem}>
            • When required by law, or to protect users, rights, and safety
          </Text>
          <Text style={styles.bulletItem}>
            • With your consent for a specific purpose
          </Text>

          <Text style={styles.sectionTitle}>10. Data Security</Text>
          <Text style={styles.paragraph}>
            We use reasonable technical and organizational measures to protect
            your information. No online service is completely secure. Please
            protect your login email and device.
          </Text>

          <Text style={styles.sectionTitle}>11. How Long We Keep Data</Text>
          <Text style={styles.paragraph}>
            We keep your information while your account is active and as needed
            to provide the service. If you delete your account, we follow our
            Account Deletion Policy (including a short grace period, then
            permanent removal of personal account data, subject to limited legal
            or safety retention).
          </Text>

          <Text style={styles.sectionTitle}>12. Your Choices & Rights</Text>
          <Text style={styles.bulletItem}>• Update your profile and photos in the app</Text>
          <Text style={styles.bulletItem}>
            • Control location, camera, microphone, and notification permissions
            on your device
          </Text>
          <Text style={styles.bulletItem}>• Block users and manage privacy settings</Text>
          <Text style={styles.bulletItem}>
            • Delete your account from Settings → Account → Delete account
          </Text>
          <Text style={styles.bulletItem}>
            • Contact us to ask questions about your data
          </Text>

          <Text style={styles.sectionTitle}>13. Children’s Privacy</Text>
          <Text style={styles.paragraph}>
            Luvstor is not directed to children. Users must be 18 or older.
          </Text>

          <Text style={styles.sectionTitle}>14. Changes to This Policy</Text>
          <Text style={styles.paragraph}>
            We may update this Privacy Policy from time to time. We will post
            the updated version in the app and change the “Last updated” date.
            Important changes may also be communicated in-app or by email.
          </Text>

          <Text style={styles.sectionTitle}>15. Contact Us</Text>
          <Text style={styles.paragraph}>
            Questions about privacy or your data:
          </Text>
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
