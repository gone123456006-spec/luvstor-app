import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ListRowSkeleton } from '../components/ScreenSkeleton';
import WhatsAppAvatar, { getDisplayName } from '../components/WhatsAppAvatar';
import { apiRequest } from '../utils/api';
import { getAuthToken } from '../utils/auth';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  primary: '#6750A4',
  danger: '#FF4B6E',
  green: '#25D366',
};

type HistoryItem = {
  callId: string;
  callType: 'voice' | 'video';
  status: string;
  direction: 'incoming' | 'outgoing';
  durationSec: number;
  startedAt: string;
  other: { id: string; name: string; photo?: string; gender?: string };
};

function statusCopy(item: HistoryItem) {
  if (item.status === 'missed') return 'Missed';
  if (item.status === 'rejected') return 'Declined';
  if (item.status === 'cancelled') return 'Cancelled';
  if (item.status === 'busy') return 'Busy';
  if (item.status === 'unavailable') return 'Unavailable';
  if (item.durationSec > 0) {
    const m = Math.floor(item.durationSec / 60);
    const s = item.durationSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  return item.status;
}

export default function CallHistoryScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HistoryItem[]>([]);

  const load = useCallback(async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await apiRequest('/api/calls/history?limit=50', token);
      setItems(res?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.bg} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calls</Text>
      </View>

      {loading ? (
        <ListRowSkeleton count={8} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.callId}
          contentContainerStyle={
            items.length ? styles.list : styles.emptyWrap
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={48} color="#CCC" />
              <Text style={styles.emptyText}>No call history yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const missed = item.status === 'missed';
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: '/messages/[id]',
                    params: { id: item.other.id, name: item.other.name },
                  } as any)
                }
              >
                <WhatsAppAvatar
                  name={getDisplayName(item.other.name)}
                  photo={item.other.photo}
                  gender={item.other.gender}
                  size={52}
                />
                <View style={styles.rowBody}>
                  <Text
                    style={[styles.name, missed && { color: WA.danger }]}
                    numberOfLines={1}
                  >
                    {getDisplayName(item.other.name)}
                  </Text>
                  <View style={styles.metaRow}>
                    <Ionicons
                      name={
                        item.direction === 'incoming'
                          ? 'arrow-down-left'
                          : 'arrow-up-right'
                      }
                      size={14}
                      color={missed ? WA.danger : WA.green}
                    />
                    <Text style={styles.meta}>{statusCopy(item)}</Text>
                  </View>
                </View>
                <Ionicons
                  name={item.callType === 'video' ? 'videocam' : 'call'}
                  size={22}
                  color={WA.primary}
                />
              </TouchableOpacity>
            );
          }}
        />
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
  list: { paddingVertical: 8 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { marginTop: 12, color: '#999', fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
    backgroundColor: WA.white,
  },
  rowBody: { flex: 1 },
  name: { fontSize: 17, color: WA.text, fontWeight: '500' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  meta: { fontSize: 13, color: WA.secondary },
});
