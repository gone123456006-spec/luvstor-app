import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from './../contexts/AuthContext';
import { consumePendingProfileId } from '../utils/pendingProfileLink';
import { captureInstallReferrerOnce } from '../utils/pendingReferral';

export default function Index() {
  const { user } = useAuth();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Capture Play Store install referrer once per install; login awaits it
      void captureInstallReferrerOnce().catch(() => {});

      if (!user) {
        if (!cancelled) setHref('/welcome');
        return;
      }
      try {
        const pendingId = await consumePendingProfileId();
        if (pendingId) {
          if (!cancelled) setHref(`/u/${pendingId}`);
          return;
        }
        // The tabs gate decides Create profile / Enable location / retry
        if (!cancelled) setHref('/(tabs)');
      } catch {
        // Tabs gate re-verifies (with a retry screen) — never assume "new user" on error
        if (!cancelled) setHref('/(tabs)');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!href) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#FDF8FF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color="#6750A4" />
      </View>
    );
  }
  return <Redirect href={href as any} />;
}
