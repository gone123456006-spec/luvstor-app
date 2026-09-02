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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  green: '#25D366',
  teal: '#6750A4',
  danger: '#FF4B6E',
  header: '#FDF8FF',
};

const REASONS = [
  { id: 'found_someone', label: 'Found someone', icon: 'heart' as const, color: '#FF4B6E' },
  { id: 'privacy', label: 'Privacy concerns', icon: 'eye-off' as const, color: '#53BDEB' },
  { id: 'notifications', label: 'Too many notifications', icon: 'notifications-off' as const, color: '#FF9800' },
  { id: 'no_matches', label: "Didn't get matches", icon: 'sad-outline' as const, color: '#9C27B0' },
  { id: 'break', label: 'Taking a break', icon: 'pause' as const, color: '#00A884' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal' as const, color: '#667781' },
];

export default function DeleteReasonScreen() {
  const router = useRouter();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');

  const isOtherSelected = selectedReason === 'other';
  const canContinue =
    !!selectedReason && (!isOtherSelected || otherReason.trim().length > 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Why are you leaving?</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionHint}>
          Your feedback helps us improve Luvstor. Choose one reason:
        </Text>

        {/* WhatsApp-style list */}
        <View style={styles.listGroup}>
          {REASONS.map((reason, index) => {
            const selected = selectedReason === reason.id;
            return (
              <View key={reason.id}>
                <TouchableOpacity
                  style={styles.listRow}
                  activeOpacity={0.7}
                  onPress={() => setSelectedReason(reason.id)}
                >
                  <View style={[styles.iconCircle, { backgroundColor: reason.color }]}>
                    <Ionicons name={reason.icon} size={20} color="#fff" />
                  </View>
                  <Text style={styles.rowLabel}>{reason.label}</Text>
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
                {index < REASONS.length - 1 && <View style={styles.divider} />}
              </View>
            );
          })}
        </View>

        {isOtherSelected && (
          <View style={styles.otherBox}>
            <TextInput
              style={styles.otherInput}
              placeholder="Tell us more..."
              placeholderTextColor={WA.secondary}
              value={otherReason}
              onChangeText={setOtherReason}
              multiline
              textAlignVertical="top"
              maxLength={300}
            />
            <Text style={styles.charCount}>{otherReason.length}/300</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.8} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.continueBtn, !canContinue && styles.btnDisabled]}
          activeOpacity={0.8}
          onPress={() => canContinue && router.push('/delete-account/reflection' as any)}
          disabled={!canContinue}
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
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: WA.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioOn: {
    borderColor: WA.teal,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: WA.teal,
  },
  otherBox: {
    backgroundColor: WA.white,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  otherInput: {
    minHeight: 90,
    fontSize: 16,
    color: WA.text,
    padding: 0,
  },
  charCount: {
    alignSelf: 'flex-end',
    fontSize: 12,
    color: WA.secondary,
    marginTop: 8,
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
