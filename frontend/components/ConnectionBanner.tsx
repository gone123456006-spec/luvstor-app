import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  bannerKind,
  getConnectivity,
  msUntilBannerChange,
  retryConnectionNow,
  subscribeConnectivity,
} from '../utils/connectivity';

/**
 * One app-wide connection bar: offline, server/socket trouble (retrying), and a
 * short "Back online" once either clears. Screens keep showing cached content.
 */
export default function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const conn = useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
  const [now, setNow] = useState(() => Date.now());

  // Wake once when a pending state crosses its show / hide delay — no polling
  useEffect(() => {
    const wait = msUntilBannerChange(conn, Date.now());
    if (wait == null) return;
    const t = setTimeout(() => setNow(Date.now()), wait + 30);
    return () => clearTimeout(t);
  }, [conn, now]);

  const kind = bannerKind(conn, Math.max(now, conn.recoveredAt));
  if (!kind) return null;

  const style =
    kind === 'offline' ? styles.offline : kind === 'reconnecting' ? styles.reconnecting : styles.back;
  const icon =
    kind === 'offline'
      ? 'cloud-offline-outline'
      : kind === 'reconnecting'
        ? 'sync-outline'
        : 'checkmark-circle-outline';
  const label =
    kind === 'offline'
      ? "You're offline"
      : kind === 'reconnecting'
        ? 'Connection problem — retrying…'
        : 'Back online';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 4 }]}>
      <View style={[styles.pill, style]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Ionicons name={icon} size={15} color="#fff" />
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
        {kind === 'reconnecting' ? (
          <Pressable
            onPress={retryConnectionNow}
            hitSlop={10}
            style={styles.retry}
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9998,
    elevation: 9,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    maxWidth: '92%',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  offline: { backgroundColor: '#3C3C43' },
  reconnecting: { backgroundColor: '#B3261E' },
  back: { backgroundColor: '#1E8E3E' },
  text: { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1 },
  retry: {
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
