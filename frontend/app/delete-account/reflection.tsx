import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState, useEffect } from 'react';
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
  teal: '#6750A4',
  green: '#6750A4',
  danger: '#FF4B6E',
  header: '#FDF8FF',
};

const LOSE_ITEMS = [
  { icon: 'heart' as const, label: 'All your matches and connections', color: '#FF4B6E' },
  { icon: 'chatbubbles' as const, label: 'Your entire chat history', color: '#53BDEB' },
  { icon: 'images' as const, label: 'All shared photos and memories', color: '#9C27B0' },
  { icon: 'notifications' as const, label: 'New match notifications', color: '#FF9800' },
];

export default function ReflectionScreen() {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [canContinue, setCanContinue] = useState(false);

  useEffect(() => {
    if (secondsLeft > 0) {
      const timer = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
      return () => clearTimeout(timer);
    }
    setCanContinue(true);
  }, [secondsLeft]);

  const handleKeepAccount = () => {
    router.replace('/(tabs)/profile' as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Take a moment</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Timer — WhatsApp style */}
        <View style={styles.timerBlock}>
          <View style={styles.timerCircle}>
            <Text style={styles.timerText}>{secondsLeft}</Text>
          </View>
          <Text style={styles.timerHint}>
            {canContinue ? 'You can continue now' : `Please wait ${secondsLeft}s`}
          </Text>
        </View>

        <Text style={styles.sectionHint}>
          Most members who delete their account regret losing all their matches. Are you sure?
        </Text>

        {/* WhatsApp-style list */}
        <View style={styles.listGroup}>
          {LOSE_ITEMS.map((item, index) => (
            <View key={item.label}>
              <View style={styles.listRow}>
                <View style={[styles.iconCircle, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon} size={20} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>{item.label}</Text>
              </View>
              {index < LOSE_ITEMS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>You'll lose access to everything above.</Text>

        {/* Keep account row */}
        <View style={[styles.listGroup, { marginTop: 12 }]}>
          <TouchableOpacity style={styles.listRow} activeOpacity={0.7} onPress={handleKeepAccount}>
            <View style={[styles.iconCircle, { backgroundColor: WA.teal }]}>
              <Ionicons name="shield-checkmark" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Keep my account</Text>
              <Text style={styles.rowSub}>Pause or hide your profile instead</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.keepBtn} activeOpacity={0.8} onPress={handleKeepAccount}>
          <Text style={styles.keepText}>Keep My Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.continueBtn, !canContinue && styles.btnDisabled]}
          activeOpacity={0.8}
          onPress={() => canContinue && router.push('/delete-account/confirmation' as any)}
          disabled={!canContinue}
        >
          <Text style={styles.continueText}>
            {canContinue ? 'Continue' : `Wait ${secondsLeft}s`}
          </Text>
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
  timerBlock: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 8,
  },
  timerCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: WA.white,
    borderWidth: 3,
    borderColor: WA.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 36,
    fontWeight: '700',
    color: WA.teal,
  },
  timerHint: {
    marginTop: 10,
    fontSize: 14,
    color: WA.secondary,
  },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 16,
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
  rowLabel: {
    flex: 1,
    fontSize: 17,
    color: WA.text,
    fontWeight: '400',
  },
  rowSub: {
    fontSize: 13,
    color: WA.secondary,
    marginTop: 2,
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
