import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../../utils/api';
import { getAuthToken } from '../../utils/auth';
import { useAuth } from '../../contexts/AuthContext';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  teal: '#6750A4',
  danger: '#FF4B6E',
  header: '#FDF8FF',
};

const TIMELINE = [
  {
    icon: 'flash' as const,
    label: 'Immediate deactivation',
    sub: 'Your account is deactivated right away',
    color: '#FF9800',
  },
  {
    icon: 'eye-off' as const,
    label: 'Profile hidden',
    sub: 'Your profile is hidden from all users',
    color: '#53BDEB',
  },
  {
    icon: 'time' as const,
    label: '7-day grace period',
    sub: 'Restore anytime by logging in within 7 days',
    color: '#00A884',
  },
  {
    icon: 'mail' as const,
    label: 'Day 5 reminder',
    sub: "We'll email you 2 days before permanent deletion",
    color: '#9C27B0',
  },
  {
    icon: 'trash' as const,
    label: 'Permanent deletion',
    sub: 'After 7 days all data is permanently deleted',
    color: '#EA4335',
  },
];

export default function FinalConfirmationScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleKeepAccount = () => {
    router.replace('/(tabs)/profile' as any);
  };

  const handleDeleteAccount = async () => {
    try {
      setIsDeleting(true);
      const token = await getAuthToken();
      if (!token) {
        Alert.alert('Error', 'Please sign in again');
        setIsDeleting(false);
        return;
      }

      const response: any = await apiRequest('/api/auth/delete-account', token, {
        method: 'POST',
      });

      if (response.success) {
        Alert.alert(
          'Account Deactivated',
          'Your account has been deactivated and will be permanently deleted in 7 days. You can restore it anytime before then by logging in.',
          [
            {
              text: 'OK',
              onPress: async () => {
                await signOut();
                router.replace('/login' as any);
              },
            },
          ]
        );
      } else {
        throw new Error(response.error || 'Failed to delete account');
      }
    } catch (error: any) {
      console.error('Delete account error:', error);
      Alert.alert('Error', error.message || 'Failed to delete account. Please try again.');
      setIsDeleting(false);
    }
  };

  const confirmDeletion = () => {
    Alert.alert(
      'Final Confirmation',
      'Are you absolutely sure? This will deactivate your account immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, Delete', style: 'destructive', onPress: handleDeleteAccount },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          disabled={isDeleting}
        >
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Final step</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionHint}>Before we proceed, here's what will happen:</Text>

        <View style={styles.listGroup}>
          {TIMELINE.map((item, index) => (
            <View key={item.label}>
              <View style={styles.listRow}>
                <View style={[styles.iconCircle, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={20} color="#fff" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  <Text style={styles.rowSub}>{item.sub}</Text>
                </View>
              </View>
              {index < TIMELINE.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>
          You'll receive a confirmation email once deletion is complete.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.keepBtn}
          activeOpacity={0.8}
          onPress={handleKeepAccount}
          disabled={isDeleting}
        >
          <Text style={styles.keepText}>Keep My Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteBtn, isDeleting && styles.btnDisabled]}
          activeOpacity={0.8}
          onPress={confirmDeletion}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.deleteText}>Delete Account</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WA.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: WA.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EADDFF', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  scroll: { paddingBottom: 120 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    lineHeight: 20,
  },
  listGroup: { backgroundColor: WA.white },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 17, color: WA.text, fontWeight: '400' },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2, lineHeight: 18 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  footnote: {
    fontSize: 13,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 10,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: WA.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: WA.border,
  },
  keepBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: WA.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keepText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  deleteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: WA.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  deleteText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
