import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppPermissionId,
  getAllPermissionStatuses,
  PermStatus,
  requestEssentialPermissions,
  requestPermissionById,
} from '../../utils/appPermissions';

const WA = {
  bg: '#F5F5F7',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#6B7280',
  border: '#E8E8ED',
  primary: '#370372',
  ok: '#25D366',
  warn: '#F59E0B',
  header: '#F5F5F7',
};

type RowDef = {
  id: AppPermissionId;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  sub: string;
  /** Hide on platforms where it does not apply */
  androidOnly?: boolean;
};

const ROWS: RowDef[] = [
  {
    id: 'calls',
    icon: 'call',
    color: '#128C7E',
    label: 'Calls',
    sub: 'Microphone + camera for voice & video calls',
  },
  {
    id: 'microphone',
    icon: 'mic',
    color: '#EA4335',
    label: 'Microphone',
    sub: 'Voice messages and calls',
  },
  {
    id: 'music',
    icon: 'musical-notes',
    color: '#9C27B0',
    label: 'Music and audio',
    sub: 'Access audio files on this device',
    androidOnly: true,
  },
  {
    id: 'photos',
    icon: 'images',
    color: '#4285F4',
    label: 'Images and videos',
    sub: 'Photos and videos for chat & profile',
  },
  {
    id: 'camera',
    icon: 'camera',
    color: '#34A853',
    label: 'Camera',
    sub: 'Photos, verification and video calls',
  },
  {
    id: 'notifications',
    icon: 'notifications',
    color: '#25D366',
    label: 'Notifications',
    sub: 'Messages, matches and incoming calls',
  },
];

function statusLabel(s: PermStatus): string {
  if (s === 'granted') return 'Allowed';
  if (s === 'unavailable') return 'Not needed';
  if (s === 'undetermined') return 'Not set';
  return 'Denied';
}

function statusColor(s: PermStatus): string {
  if (s === 'granted') return WA.ok;
  if (s === 'unavailable') return WA.secondary;
  if (s === 'undetermined') return WA.warn;
  return '#EA4335';
}

export default function PermissionsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<AppPermissionId | 'all' | null>(null);
  const [statuses, setStatuses] = useState<
    Partial<Record<AppPermissionId, PermStatus>>
  >({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getAllPermissionStatuses();
      setStatuses(snap);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onAllow = async (id: AppPermissionId) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await requestPermissionById(id);
      const snap = await getAllPermissionStatuses();
      setStatuses(snap);
    } finally {
      setBusyId(null);
    }
  };

  const onAllowAll = async () => {
    if (busyId) return;
    setBusyId('all');
    try {
      await requestEssentialPermissions();
      const snap = await getAllPermissionStatuses();
      setStatuses(snap);
    } finally {
      setBusyId(null);
    }
  };

  const visibleRows = ROWS.filter(
    (r) => !(r.androidOnly && Platform.OS !== 'android'),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Permissions</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.sectionHint}>
          Allow access here — the system will ask inside the app. You do not
          need to open phone Settings unless you previously blocked a
          permission.
        </Text>

        <TouchableOpacity
          style={styles.allowAllBtn}
          activeOpacity={0.85}
          disabled={!!busyId}
          onPress={onAllowAll}
        >
          {busyId === 'all' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.allowAllText}>Allow all</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.sectionHint}>All info</Text>

        <View style={styles.listGroup}>
          {/* Call logs — Luvstor never reads the phone dialer log (Play policy) */}
          <View style={styles.listRow}>
            <View style={[styles.iconCircle, { backgroundColor: '#54656F' }]}>
              <Ionicons name="call-outline" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Call logs</Text>
              <Text style={styles.rowSub}>
                Phone dialer logs are not used. Luvstor only stores its own
                voice/video call history.
              </Text>
              <Text style={[styles.statusText, { color: WA.secondary }]}>
                Not used
              </Text>
            </View>
            <Ionicons name="remove-circle-outline" size={22} color={WA.secondary} />
          </View>
          <View style={styles.divider} />

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={WA.primary} />
            </View>
          ) : (
            visibleRows.map((row, i) => {
              const st = statuses[row.id] || 'undetermined';
              const granted = st === 'granted' || st === 'unavailable';
              return (
                <React.Fragment key={row.id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.listRow}>
                    <View
                      style={[styles.iconCircle, { backgroundColor: row.color }]}
                    >
                      <Ionicons name={row.icon} size={20} color="#fff" />
                    </View>
                    <View style={styles.rowContent}>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      <Text style={styles.rowSub}>{row.sub}</Text>
                      <Text
                        style={[styles.statusText, { color: statusColor(st) }]}
                      >
                        {statusLabel(st)}
                      </Text>
                    </View>
                    {!granted ? (
                      <TouchableOpacity
                        style={styles.allowBtn}
                        activeOpacity={0.8}
                        disabled={!!busyId}
                        onPress={() => void onAllow(row.id)}
                      >
                        {busyId === row.id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.allowBtnText}>Allow</Text>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={WA.ok}
                      />
                    )}
                  </View>
                </React.Fragment>
              );
            })
          )}
        </View>

        <Text style={[styles.sectionHint, { paddingTop: 8 }]}>
          Tap Allow to show the system permission popup inside the app. Only if
          you previously chose “Don’t ask again” will you need phone Settings.
        </Text>
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
    backgroundColor: '#EFE8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  scroll: { paddingBottom: 40, paddingTop: 4 },
  sectionHint: {
    fontSize: 14,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    lineHeight: 20,
  },
  allowAllBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    height: 48,
    borderRadius: 14,
    backgroundColor: WA.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  allowAllText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listGroup: { backgroundColor: WA.bg },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  loadingRow: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  rowLabel: { fontSize: 17, fontWeight: '400', color: WA.text },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  allowBtn: {
    minWidth: 72,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: WA.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allowBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
