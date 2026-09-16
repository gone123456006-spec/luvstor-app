import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBase } from '../../utils/api';
import { setPendingReferralCode } from '../../utils/pendingReferral';
import { useAuth } from '../../contexts/AuthContext';
import { resolvePostLoginRoute } from '../../utils/auth';

/**
 * App Link: https://luvstor-api.onrender.com/go/SLUG
 * Resolves short link → referral capture or profile screen.
 */
export default function GoShortLinkScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = String(
    Array.isArray(params.slug) ? params.slug[0] : params.slug || '',
  )
    .trim()
    .toUpperCase();

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!slug) {
        router.replace('/(tabs)' as any);
        return;
      }
      try {
        const res = await fetch(`${getApiBase()}/api/share/resolve/${slug}`);
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;

        if (data?.type === 'referral' && data.referralCode) {
          await setPendingReferralCode(data.referralCode);
          if (!user) {
            router.replace('/login' as any);
            return;
          }
          const route = await resolvePostLoginRoute(user);
          router.replace(route as any);
          return;
        }

        if (data?.type === 'profile' && data.publicId) {
          if (!user) {
            router.replace({
              pathname: '/login',
              params: { redirect: `u/${data.publicId}` },
            } as any);
            return;
          }
          router.replace(`/u/${data.publicId}` as any);
          return;
        }
      } catch {
        /* fall through */
      }
      if (!cancelled) router.replace('/(tabs)' as any);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, user, router]);

  return (
    <SafeAreaView style={styles.wrap}>
      <ActivityIndicator size="large" color="#7C3AED" />
      <Text style={styles.text}>Opening link…</Text>
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
