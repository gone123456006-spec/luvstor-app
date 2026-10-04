import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useStableBottomInset } from '../../hooks/useStableBottomInset';
import { tabScreenOptions, getTabBarBottomInset, getTabBarHeight } from '../../utils/navigation';
import { runWhenIdle } from '../../utils/idle';
import {
  checkProfileSetup,
  getAuthToken,
  type ProfileSetupState,
} from '../../utils/auth';
import {
  clearTokenBalanceCache,
  preloadTokenBalance,
} from '../../utils/tokenCache';
import {
  clearProfileCache,
  preloadProfile,
} from '../../utils/profileCache';
import { pingAppOpen } from '../../utils/retention';
import { needsLocationSetup } from '../../utils/locationSetup';

const TAB_PREFETCH = [
  { href: '/chat', delayMs: 800 },
  { href: '/explore', delayMs: 2500 },
] as const;

export default function TabLayout() {
  const router = useRouter();
  // Latch inset — Modals must not resize / teleport the absolute tab bar
  const stableBottom = useStableBottomInset();
  const { sessionVersion, user, signOut } = useAuth();
  const { socket, unreadCount, refreshUnread } = useSocket();
  const hadUserRef = useRef(false);
  const [profileGate, setProfileGate] = useState<
    'checking' | 'ok' | 'need-profile' | 'need-location' | 'offline'
  >('checking');
  const [gateAttempt, setGateAttempt] = useState(0);

  // WhatsApp-style: sit above 3-button / gesture nav; height stays fixed across popups
  const bottomInset = getTabBarBottomInset(stableBottom);
  const tabBarHeight = getTabBarHeight(stableBottom);

  const screenOptions = useMemo(
    () => ({
      ...tabScreenOptions,
      tabBarActiveTintColor: '#370372',
      tabBarInactiveTintColor: '#999',
      tabBarStyle: {
        position: 'absolute' as const,
        left: 0,
        right: 0,
        bottom: 0,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#E5E5E5',
        elevation: 8,
        height: tabBarHeight,
        paddingTop: 6,
        paddingBottom: bottomInset,
        backgroundColor: '#FFFFFF',
      },
      tabBarItemStyle: {
        paddingTop: 2,
        height: 52,
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '500' as const,
        marginBottom: 0,
        lineHeight: 14,
        ...(Platform.OS === 'android' ? { includeFontPadding: false } : null),
      },
    }),
    [bottomInset, tabBarHeight],
  );
  // Kick to login only after a previously active session is revoked
  useEffect(() => {
    if (user) {
      hadUserRef.current = true;
      return;
    }
    if (hadUserRef.current) {
      hadUserRef.current = false;
      router.replace('/login');
    }
  }, [user, router]);

  // New users must finish Create profile, then the one-time Enable Location
  // screen, before Discover / home tabs
  useEffect(() => {
    let cancelled = false;
    const passProfileGate = async () => {
      const token = await getAuthToken();
      const needsLocation =
        !!token && !!user?.id && (await needsLocationSetup(token, user.id));
      if (cancelled) return;
      if (needsLocation) {
        setProfileGate('need-location');
        router.replace('/enable-location');
        return;
      }
      setProfileGate('ok');
    };
    (async () => {
      if (!user?.email) {
        if (!cancelled) setProfileGate('checking');
        return;
      }
      setProfileGate((prev) => (prev === 'ok' ? prev : 'checking'));
      let state: ProfileSetupState = 'unknown';
      try {
        state = await checkProfileSetup(user);
      } catch {
        /* treated as unknown */
      }
      if (cancelled) return;
      if (state === 'signed-out') {
        // The user-cleared effect above sends the app to /login
        await signOut();
        return;
      }
      if (state === 'incomplete') {
        setProfileGate('need-profile');
        router.replace('/create-profile');
        return;
      }
      if (state === 'unknown') {
        setProfileGate((prev) => (prev === 'ok' ? prev : 'offline'));
        return;
      }
      try {
        await passProfileGate();
      } catch {
        if (!cancelled) setProfileGate('ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, sessionVersion, router, gateAttempt, signOut]);

  // Retry the gate without a tap: on return to the app, when the realtime
  // connection comes back (server awake / internet back), and on a backoff timer
  useEffect(() => {
    if (profileGate !== 'offline') return;
    const retry = () => setGateAttempt((n) => n + 1);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') retry();
    });
    socket?.on('connect', retry);
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(gateAttempt, 4));
    const timer = setTimeout(() => {
      if (AppState.currentState === 'active') retry();
    }, delay);
    return () => {
      sub.remove();
      socket?.off('connect', retry);
      clearTimeout(timer);
    };
  }, [profileGate, socket, gateAttempt]);

  useEffect(() => {
    refreshUnread();
  }, [sessionVersion, refreshUnread]);

  useEffect(() => {
    if (!user) {
      clearTokenBalanceCache();
      clearProfileCache();
      return;
    }
    if (profileGate !== 'ok') return;
    (async () => {
      const token = await getAuthToken();
      if (token) {
        void preloadTokenBalance(token);
        void pingAppOpen(token).catch(() => {});
      }
      void preloadProfile();
    })();
  }, [user, sessionVersion, profileGate]);

  // Mount Chat and Explore hidden once Discover has painted, so their first
  // open is instant. Staggered so they never compete with the Discover load.
  useEffect(() => {
    if (!user || profileGate !== 'ok') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const task = runWhenIdle(() => {
      TAB_PREFETCH.forEach(({ href, delayMs }) => {
        timers.push(
          setTimeout(() => {
            try {
              router.prefetch(href);
            } catch {
              /* tab opens normally on tap */
            }
          }, delayMs),
        );
      });
    });
    return () => {
      task.cancel();
      timers.forEach(clearTimeout);
    };
  }, [user, sessionVersion, profileGate, router]);

  if (user && profileGate === 'offline') {
    return (
      <View style={styles.gate}>
        <Ionicons name="cloud-offline-outline" size={44} color="#6750A4" />
        <Text style={styles.gateTitle}>Can&apos;t connect right now</Text>
        <Text style={styles.gateBody}>
          Check your internet connection and try again.
        </Text>
        <TouchableOpacity
          style={styles.gateBtn}
          activeOpacity={0.85}
          onPress={() => setGateAttempt((n) => n + 1)}
        >
          <Text style={styles.gateBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (user && profileGate !== 'ok') {
    return (
      <View style={styles.gate}>
        <ActivityIndicator size="large" color="#6750A4" />
      </View>
    );
  }

  return (
    <Tabs
      key={`tabs-${sessionVersion}`}
      screenOptions={screenOptions}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'flame' : 'flame-outline'}
              size={28}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          freezeOnBlur: false,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#370372', color: '#fff' },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              size={28}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'compass' : 'compass-outline'}
              size={28}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="token"
        options={{
          title: 'Tokens',
          lazy: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'diamond' : 'diamond-outline'}
              size={28}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          lazy: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={28}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#FDF8FF',
  },
  gateTitle: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1B1F',
    textAlign: 'center',
  },
  gateBody: {
    marginTop: 6,
    fontSize: 14,
    color: '#49454F',
    textAlign: 'center',
  },
  gateBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#6750A4',
  },
  gateBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
