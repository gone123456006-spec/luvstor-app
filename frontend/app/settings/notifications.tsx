import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ListRowSkeleton } from '../../components/ScreenSkeleton';
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppAlert } from '../../components/AppAlert';
import { usePush } from '../../contexts/PushContext';
import { getAuthToken } from '../../utils/auth';
import {
  fetchNotificationPreferences,
  NotificationPreferences,
  updateNotificationPreferences,
} from '../../utils/notifications';
import { isExpoGo } from '../../utils/push';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  muted: '#667781',
  border: '#E7E0EC',
  primary: '#6750A4',
  header: '#FDF8FF',
};

const DEFAULT_PREFS: NotificationPreferences = {
  chat: true,
  social: true,
  calls: true,
  wallet: true,
  system: true,
  promotions: true,
  showMessagePreview: true,
};

type ToggleRow = {
  key: keyof NotificationPreferences;
  label: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const ROWS: ToggleRow[] = [
  {
    key: 'chat',
    label: 'Messages',
    sub: 'New chat messages',
    icon: 'chatbubbles',
    color: '#25D366',
  },
  {
    key: 'showMessagePreview',
    label: 'Message preview',
    sub: 'Show message text in notifications',
    icon: 'eye',
    color: '#128C7E',
  },
  {
    key: 'social',
    label: 'Matches & likes',
    sub: 'Matches, likes and friend updates',
    icon: 'heart',
    color: '#FF4B6E',
  },
  {
    key: 'calls',
    label: 'Calls',
    sub: 'Incoming voice and video calls',
    icon: 'call',
    color: '#34B7F1',
  },
  {
    key: 'wallet',
    label: 'Tokens & wallet',
    sub: 'Purchases, rewards and balance alerts',
    icon: 'wallet',
    color: '#F59E0B',
  },
  {
    key: 'system',
    label: 'Updates',
    sub: 'App announcements and reminders',
    icon: 'information-circle',
    color: '#6750A4',
  },
  {
    key: 'promotions',
    label: 'Offers & daily summary',
    sub: 'Promotions, plus one daily recap of who liked and viewed you',
    icon: 'pricetag',
    color: '#9C27B0',
  },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const { permissionGranted, register, pushEnabled } = usePush();
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const next = await fetchNotificationPreferences(token);
      setPrefs({ ...DEFAULT_PREFS, ...next });
    } catch (e: any) {
      showAlert({
        title: 'Could not load preferences',
        message: e?.message || 'Please try again.',
      });
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const toggle = async (key: keyof NotificationPreferences, value: boolean) => {
    const prev = prefs;
    setPrefs((p) => ({ ...p, [key]: value }));
    setSavingKey(key);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('Not signed in');
      const next = await updateNotificationPreferences(token, { [key]: value });
      setPrefs({ ...DEFAULT_PREFS, ...next });
    } catch (e: any) {
      setPrefs(prev);
      showAlert({
        title: 'Could not save',
        message: e?.message || 'Please try again.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const enableDevicePush = async () => {
    if (isExpoGo) {
      showAlert({
        title: 'Dev build required',
        message:
          'Remote push needs a native Android build (not Expo Go). Run: npx expo run:android',
        icon: 'phone-portrait',
      });
      return;
    }
    const ok = await register();
    showAlert({
      title: ok ? 'Notifications enabled' : 'Permission needed',
      message: ok
        ? 'You will get alerts like WhatsApp when the app is in the background.'
        : 'Allow notifications in system settings to receive pushes.',
      icon: ok ? 'notifications' : 'notifications-off',
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ListRowSkeleton count={4} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionHint}>Device</Text>
          <View style={styles.listGroup}>
            <View style={styles.listRow}>
              <View style={[styles.iconCircle, { backgroundColor: WA.primary }]}>
                <Ionicons name="notifications" size={20} color="#fff" />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowLabel}>Push notifications</Text>
                <Text style={styles.rowSub}>
                  {isExpoGo
                    ? 'Requires a native build (Expo Go blocked)'
                    : permissionGranted
                      ? 'Allowed on this device'
                      : 'Not allowed — tap to enable'}
                </Text>
              </View>
              {!permissionGranted || isExpoGo ? (
                <TouchableOpacity onPress={enableDevicePush} style={styles.enableBtn} activeOpacity={0.7}>
                  <Text style={styles.enableText}>Enable</Text>
                </TouchableOpacity>
              ) : (
                <Ionicons name="checkmark-circle" size={22} color="#25D366" />
              )}
            </View>
          </View>

          <Text style={styles.sectionHint}>Categories</Text>
          <View style={styles.listGroup}>
            {ROWS.map((row, idx) => (
              <View key={row.key}>
                {idx > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.listRow}>
                  <View style={[styles.iconCircle, { backgroundColor: row.color }]}>
                    <Ionicons name={row.icon} size={20} color="#fff" />
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={styles.rowLabel}>{row.label}</Text>
                    <Text style={styles.rowSub}>{row.sub}</Text>
                  </View>
                  <Switch
                    value={!!prefs[row.key]}
                    onValueChange={(v) => toggle(row.key, v)}
                    disabled={savingKey === row.key}
                    trackColor={{ false: '#D0C4DC', true: '#B8A1E3' }}
                    thumbColor={prefs[row.key] ? WA.primary : '#f4f3f4'}
                    {...(Platform.OS === 'ios' ? { ios_backgroundColor: '#D0C4DC' } : {})}
                  />
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.footerNote}>
            Security alerts (new device login) always notify you and cannot be turned off.
            {!pushEnabled ? ' System tray push also needs google-services.json in a native build.' : ''}
          </Text>
        </ScrollView>
      )}
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
  scroll: { paddingBottom: 40, paddingTop: 8 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  listGroup: { backgroundColor: WA.white },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
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
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
  enableBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#EADDFF',
  },
  enableText: { color: WA.primary, fontWeight: '600', fontSize: 13 },
  footerNote: {
    fontSize: 12,
    color: WA.muted,
    paddingHorizontal: 20,
    paddingTop: 16,
    lineHeight: 18,
  },
});
