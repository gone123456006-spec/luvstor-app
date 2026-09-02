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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  primary: '#6750A4',
  primaryContainer: '#EADDFF',
  accent: '#FF4B6E',
  header: '#FDF8FF',
};

const SAFETY_RULES = [
  {
    icon: 'chatbubbles' as const,
    title: 'Keep Chats on Luvstor',
    desc: 'Do not share phone numbers, social handles, or personal addresses early on. Keep chats inside Luvstor.',
    color: '#FF4B6E',
  },
  {
    icon: 'location' as const,
    title: 'Private Boundaries',
    desc: 'Never share your exact home or work location with new matches.',
    color: '#FF9800',
  },
  {
    icon: 'cafe' as const,
    title: 'Meet in Public & Tell a Friend',
    desc: 'For first dates, choose busy public places and tell a friend your plans.',
    color: '#4CAF50',
  },
  {
    icon: 'cash' as const,
    title: 'Zero Financial Requests',
    desc: 'Never send money to matches. Report anyone asking for money immediately.',
    color: '#2196F3',
  },
  {
    icon: 'shield' as const,
    title: 'Block and Report Anytime',
    desc: 'If someone makes you uncomfortable, block them instantly. Our team reviews reports 24/7.',
    color: '#EA4335',
  },
];

const CHECKLIST = [
  { key: 'public', text: 'Meet in a crowded public space (like a cafe)' },
  { key: 'friend', text: 'Let a friend know where you are going' },
  { key: 'transport', text: 'Have your own transport arranged' },
  { key: 'privacy', text: 'Keep personal details (address, handles) private' },
  { key: 'instinct', text: 'Trust your gut — leave if uncomfortable' },
];

export default function SafetyCenterScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'rules' | 'checklist'>('rules');
  const [checked, setChecked] = useState<string[]>([]);

  const toggle = (key: string) => {
    setChecked((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Safety Center</Text>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'rules' && styles.tabActive]}
          onPress={() => setTab('rules')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === 'rules' && styles.tabTextActive]}>
            Safety Rules
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'checklist' && styles.tabActive]}
          onPress={() => setTab('checklist')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === 'checklist' && styles.tabTextActive]}>
            Date Checklist
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {tab === 'rules' ? (
          <>
            <Text style={styles.sectionHint}>Emergency</Text>
            <View style={styles.listGroup}>
              <TouchableOpacity
                style={styles.listRow}
                activeOpacity={0.7}
                onPress={() => {
                  Alert.alert(
                    'Emergency Contact',
                    'If you are in immediate danger, contact your local police (911/112). You can also reach Luvstor safety support.',
                    [
                      { text: 'Dismiss' },
                      {
                        text: 'Call Helpline',
                        onPress: () =>
                          Alert.alert('Dialing support...', 'Connecting you with safety specialists...'),
                      },
                    ]
                  );
                }}
              >
                <View style={[styles.iconCircle, { backgroundColor: '#EA4335' }]}>
                  <Ionicons name="alert" size={20} color="#fff" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowLabel, { color: '#EA4335' }]}>SOS Helpline</Text>
                  <Text style={styles.rowSub}>Need immediate help?</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionHint}>Dating safety rules</Text>
            <View style={styles.listGroup}>
              {SAFETY_RULES.map((rule, i) => (
                <View key={rule.title}>
                  <View style={styles.listRow}>
                    <View style={[styles.iconCircle, { backgroundColor: rule.color }]}>
                      <Ionicons name={rule.icon} size={20} color="#fff" />
                    </View>
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>{rule.title}</Text>
                      <Text style={styles.rowSub}>{rule.desc}</Text>
                    </View>
                  </View>
                  {i < SAFETY_RULES.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionHint}>
              Tap each item to prepare safely for your first date
            </Text>
            <View style={styles.listGroup}>
              {CHECKLIST.map((item, i) => {
                const on = checked.includes(item.key);
                return (
                  <View key={item.key}>
                    <TouchableOpacity
                      style={styles.listRow}
                      activeOpacity={0.7}
                      onPress={() => toggle(item.key)}
                    >
                      <View
                        style={[
                          styles.iconCircle,
                          { backgroundColor: on ? WA.primary : '#CAC4D0' },
                        ]}
                      >
                        <Ionicons
                          name={on ? 'checkmark' : 'ellipse-outline'}
                          size={20}
                          color="#fff"
                        />
                      </View>
                      <Text
                        style={[
                          styles.rowLabel,
                          on && { color: WA.primary, fontWeight: '600' },
                        ]}
                      >
                        {item.text}
                      </Text>
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>
                        {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                    </TouchableOpacity>
                    {i < CHECKLIST.length - 1 && <View style={styles.divider} />}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
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
    backgroundColor: WA.primaryContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: WA.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: WA.primary },
  tabText: { fontSize: 15, fontWeight: '600', color: WA.secondary },
  tabTextActive: { color: WA.primary },
  scroll: { paddingBottom: 40 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
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
    fontSize: 16,
    color: WA.text,
    fontWeight: '500',
    lineHeight: 22,
  },
  rowSub: {
    fontSize: 13,
    color: WA.secondary,
    marginTop: 3,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: WA.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxOn: {
    backgroundColor: WA.primary,
    borderColor: WA.primary,
  },
});
