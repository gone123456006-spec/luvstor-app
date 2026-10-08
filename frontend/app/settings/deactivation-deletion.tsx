import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NAV_ICON } from '../../utils/platformIcons';
import { statusBarStyle, themedPalette, themedStyles } from '../../utils/theme';

const WA = themedPalette({
  bg: '#F5F5F7',
  card: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#6B7280',
  border: '#E8E8ED',
  header: '#F5F5F7',
});

export default function DeactivationDeletionScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={statusBarStyle()} backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Deactivation or deletion</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Delete your Luvstor account?</Text>
        <Text style={styles.intro}>
          If you just need a break, you can log out instead — your matches and chats will be
          waiting when you come back.
        </Text>

        <Pressable
          onPress={() => setSelected((v) => !v)}
          style={[styles.option, selected && styles.optionSelected]}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected }}
        >
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Delete account</Text>
            <Text style={styles.optionSub}>
              Deleting is permanent. Your profile, photos, posts, chats, likes and tokens will be
              removed and cannot be recovered.
            </Text>
          </View>
          <View style={[fixed.radio, selected && fixed.radioOn]}>
            {selected ? <View style={fixed.radioDot} /> : null}
          </View>
        </Pressable>

        <TouchableOpacity
          onPress={() => router.push('/settings/account-deletion' as any)}
          activeOpacity={0.7}
          style={styles.policyLink}
        >
          <Text style={fixed.linkText}>What gets deleted and when</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          disabled={!selected}
          onPress={() => router.push('/delete-account/warning' as any)}
          activeOpacity={0.85}
          style={[fixed.continueBtn, !selected && fixed.continueDisabled]}
        >
          <Text style={fixed.continueText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
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
      backgroundColor: '#EFE8F8',
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '600', color: WA.text },
    scroll: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32 },
    title: { fontSize: 22, fontWeight: '700', color: WA.text },
    intro: { fontSize: 14, lineHeight: 20, color: WA.secondary, marginTop: 8, marginBottom: 20 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 16,
      borderRadius: 14,
      backgroundColor: WA.card,
      borderWidth: 1,
      borderColor: WA.border,
    },
    optionSelected: { borderColor: WA.text },
    optionText: { flex: 1 },
    optionTitle: { fontSize: 16, fontWeight: '600', color: WA.text },
    optionSub: { fontSize: 13, lineHeight: 19, color: WA.secondary, marginTop: 4 },
    policyLink: { marginTop: 18, alignSelf: 'flex-start' },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: WA.border,
      backgroundColor: WA.bg,
    },
  }),
);

const fixed = StyleSheet.create({
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: '#7C3AED' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#7C3AED' },
  linkText: { fontSize: 14, fontWeight: '600', color: '#7C3AED' },
  continueBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueDisabled: { opacity: 0.4 },
  continueText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
