import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from './../contexts/AuthContext';
import { resolvePostLoginRoute } from '../utils/auth';
import { consumePendingProfileId } from '../utils/pendingProfileLink';
import { captureInstallReferrerOnce } from '../utils/pendingReferral';

export default function Index() {
  const { user } = useAuth();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Capture Play Store install referrer ASAP (once per install)
      try {
        await captureInstallReferrerOnce();
      } catch {
        /* ignore */
      }

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
        const route = await resolvePostLoginRoute(user);
        if (!cancelled) setHref(route);
      } catch {
        if (!cancelled) setHref('/create-profile');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!href) return null;
  return <Redirect href={href as any} />;
}
