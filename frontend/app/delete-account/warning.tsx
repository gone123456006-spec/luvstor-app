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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  green: '#6750A4',
  danger: '#FF4B6E',
  header: '#FDF8FF',
};

const WARNING_ITEMS = [
  { icon: 'heart-dislike' as const, label: 'All Matches', color: '#FF4B6E' },
  { icon: 'chatbubbles' as const, label: 'All Chats & Messages', color: '#53BDEB' },
  { icon: 'images' as const, label: 'All Photos', color: '#9C27B0' },
  { icon: 'card' as const, label: 'Active Subscription', color: '#FF9800' },
  { icon: 'person' as const, label: 'Your Profile', color: '#00A884' },
];

export default function DeleteWarningScreen() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delete account</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionHint}>
          Deleting your account is permanent. You will lose:
        </Text>

        {/* WhatsApp-style grouped list */}
        <View style={styles.listGroup}>
          {WARNING_ITEMS.map((item, index) => (
            <View key={item.label}>
              <View style={styles.listRow}>
                <View style={[styles.iconCircle, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={20} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>{item.label}</Text>
              </View>
              {index < WARNING_ITEMS.length - 1 && (
                <View style={styles.divider} />
              )}
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>
          After a 7-day grace period, there is no going back. Please be certain.
        </Text>

        {/* Checkbox row — WhatsApp list style */}
        <View style={[styles.listGroup, { marginTop: 8 }]}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => setAgreed(!agreed)}
          >
            <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
              {agreed && <Ionicons name="checkmark" size={16} color="#fff" />}
            </View>
            <Text style={styles.rowLabel}>I understand this action is permanent</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.8} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.continueBtn, !agreed && styles.btnDisabled]}
          activeOpacity={0.8}
          onPress={() => agreed && router.push('/delete-account/reason' as any)}
          disabled={!agreed}
        >
          <Text style={styles.continueText}>Continue</Text>
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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EADDFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  listGroup: {
    backgroundColor: WA.white,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: WA.white,
    gap: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 17,
    color: WA.text,
    fontWeight: '400',
  },
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
    paddingBottom: 8,
    lineHeight: 18,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: WA.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxOn: {
    backgroundColor: WA.green,
    borderColor: WA.green,
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
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EADDFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: WA.text },
  continueBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: WA.danger,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  continueText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
