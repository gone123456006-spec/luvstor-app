import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppAlert } from '../components/AppAlert';
import { ListRowSkeleton } from '../components/ScreenSkeleton';
import WhatsAppAvatar, { getDisplayName } from '../components/WhatsAppAvatar';
import { API_BASE } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import {
  BlockedUser,
  getBlockedUsers,
  unblockUser,
} from '../utils/friends';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  muted: '#667781',
  border: '#E7E0EC',
  primary: '#6750A4',
  danger: '#EA4335',
  header: '#FDF8FF',
};

function resolvePhoto(photo?: string) {
  if (!photo) return '';
  if (photo.startsWith('http') || photo.startsWith('data:')) return photo;
  return `${API_BASE}${photo}`;
}

function formatBlockedAt(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const { showAlert } = useAppAlert();
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (soft = false) => {
    try {
      if (!soft) setLoading(true);
      const token = await getAuthToken();
      if (!token) return;
      const list = await getBlockedUsers(token);
      setItems(list);
    } catch (e: any) {
      showAlert({
        title: 'Could not load',
        message: e?.message || 'Please try again.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showAlert]);

  useFocusEffect(
    useCallback(() => {
      load(items.length > 0);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const confirmUnblock = (row: BlockedUser) => {
    const name = getDisplayName(row.otherUser?.name) || 'this user';
    showAlert({
      title: `Unblock ${name}?`,
      message: 'They will be able to see your profile and message you again.',
      buttons: [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'primary',
          onPress: async () => {
            setBusyId(row.otherId);
            try {
              const token = await getAuthToken();
              if (!token) return;
              await unblockUser(token, row.otherId);
              setItems((prev) => prev.filter((x) => x.otherId !== row.otherId));
            } catch (e: any) {
              showAlert({
                title: 'Could not unblock',
                message: e?.message || 'Please try again.',
              });
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    });
  };

  const renderItem = ({ item }: { item: BlockedUser }) => {
    const name = getDisplayName(item.otherUser?.name) || 'User';
    const busy = busyId === item.otherId;

    return (
      <View style={styles.row}>
        <WhatsAppAvatar
          photo={resolvePhoto(item.otherUser?.photo)}
          name={name}
          size={52}
        />
        <View style={styles.rowInfo}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.blockedAt
              ? `Blocked ${formatBlockedAt(item.blockedAt)}`
              : 'Blocked'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.unblockBtn}
          activeOpacity={0.7}
          onPress={() => confirmUnblock(item)}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={WA.primary} />
          ) : (
            <Text style={styles.unblockText}>Unblock</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={10}
        >
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked</Text>
      </View>

      <Text style={styles.hint}>
        People you block can't message you or see your profile. Unblock anytime.
      </Text>

      {loading ? (
        <ListRowSkeleton count={6} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.otherId}
          renderItem={renderItem}
          contentContainerStyle={
            items.length ? styles.listContent : styles.emptyWrap
          }
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(true);
              }}
              tintColor={WA.primary}
              colors={[WA.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="ban-outline" size={36} color={WA.primary} />
              </View>
              <Text style={styles.emptyTitle}>No blocked contacts</Text>
              <Text style={styles.emptyText}>
                When you block someone from a chat, they will appear here.
              </Text>
            </View>
          }
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
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: WA.text,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: WA.secondary,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  listContent: {
    backgroundColor: WA.white,
    paddingBottom: 28,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: WA.white,
    gap: 12,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
    color: WA.text,
  },
  rowSub: {
    fontSize: 13,
    color: WA.muted,
    marginTop: 2,
  },
  unblockBtn: {
    minWidth: 84,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E8FF',
  },
  unblockText: {
    fontSize: 13,
    fontWeight: '700',
    color: WA.primary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 80,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: { flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
    gap: 8,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EADDFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#666',
  },
  emptyText: {
    fontSize: 13.5,
    color: '#AAA',
    textAlign: 'center',
    lineHeight: 18,
  },
});
