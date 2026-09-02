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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  teal: '#6750A4',
  green: '#4CAF50',
  danger: '#FF4B6E',
  orange: '#FF9800',
  header: '#FDF8FF',
};

const REQUIRED_TEXT = 'DELETE MY ACCOUNT';

export default function ConfirmationScreen() {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState('');
  const isValid = confirmText === REQUIRED_TEXT;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={24} color={WA.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Type to confirm</Text>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionHint}>
            To confirm, type the text below exactly as shown:
          </Text>

          {/* Required phrase row */}
          <View style={styles.listGroup}>
            <View style={styles.listRow}>
              <View style={[styles.iconCircle, { backgroundColor: WA.orange }]}>
                <Ionicons name="key" size={20} color="#fff" />
              </View>
              <Text style={styles.requiredText}>{REQUIRED_TEXT}</Text>
            </View>
          </View>

          <Text style={styles.sectionHint}>Type here</Text>

          <View style={styles.listGroup}>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="DELETE MY ACCOUNT"
                placeholderTextColor={WA.secondary}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            {confirmText.length > 0 && (
              <>
                <View style={styles.divider} />
                <View style={styles.listRow}>
                  <View
                    style={[
                      styles.iconCircle,
                      { backgroundColor: isValid ? WA.green : WA.danger },
                    ]}
                  >
                    <Ionicons
                      name={isValid ? 'checkmark' : 'close'}
                      size={20}
                      color="#fff"
                    />
                  </View>
                  <Text style={[styles.rowLabel, { color: isValid ? WA.green : WA.danger }]}>
                    {isValid ? 'Match confirmed' : "Text doesn't match"}
                  </Text>
                </View>
              </>
            )}
          </View>

          <Text style={styles.footnote}>
            This security step ensures only you can delete your account.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.8} onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.continueBtn, !isValid && styles.btnDisabled]}
            activeOpacity={0.8}
            onPress={() => isValid && router.push('/delete-account/final' as any)}
            disabled={!isValid}
          >
            <Text style={styles.continueText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  requiredText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: WA.text,
    letterSpacing: 1,
  },
  rowLabel: { flex: 1, fontSize: 17, fontWeight: '400' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  inputRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  input: {
    fontSize: 17,
    color: WA.text,
    fontWeight: '600',
    letterSpacing: 1,
    padding: 0,
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
