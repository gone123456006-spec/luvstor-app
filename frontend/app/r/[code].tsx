import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  normalizeReferralCode,
  setPendingReferralCode,
} from '../../utils/pendingReferral';
import { resolvePostLoginRoute } from '../../utils/auth';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Deep link: luvstor://r/CODE or https://…/r/CODE
 * Stores invite for login attribution, then continues into the app.
 */
export default function ReferralDeepLinkScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const code = normalizeReferralCode(
    Array.isArray(params.code) ? params.code[0] : params.code,
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (code) await setPendingReferralCode(code);
      if (cancelled) return;
      if (!user) {
        router.replace('/login' as any);
        return;
      }
      // Already signed in — invite is for new accounts only; go home
      try {
        const route = await resolvePostLoginRoute(user);
        if (!cancelled) router.replace(route as any);
      } catch {
        if (!cancelled) router.replace('/(tabs)' as any);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, user, router]);

  return (
    <SafeAreaView style={styles.wrap}>
      <ActivityIndicator size="large" color="#7C3AED" />
      <Text style={styles.text}>Opening invite…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F0FF',
    gap: 12,
  },
  text: { color: '#6B6B6B', fontSize: 15 },
});
