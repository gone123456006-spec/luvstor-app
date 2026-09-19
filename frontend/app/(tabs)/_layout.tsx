import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useStableBottomInset } from '../../hooks/useStableBottomInset';
import { tabScreenOptions, getTabBarBottomInset, getTabBarHeight } from '../../utils/navigation';
import {
  getAuthToken,
  getLocalProfile,
  isLocalProfileComplete,
  normalizeEmail,
  resolvePostLoginRoute,
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

export default function TabLayout() {
  const router = useRouter();
  // Latch inset — Modals must not resize / teleport the absolute tab bar
  const stableBottom = useStableBottomInset();
  const { sessionVersion, user } = useAuth();
  const { unreadCount, refreshUnread } = useSocket();
  const hadUserRef = useRef(false);
  const [profileGate, setProfileGate] = useState<
    'checking' | 'ok' | 'need-profile'
  >('checking');

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
        backgroundColor: '#F5F5F7',
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

  // New users must finish Create profile before Discover / home tabs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.email) {
        if (!cancelled) setProfileGate('checking');
        return;
      }
      try {
        const route = await resolvePostLoginRoute(user);
        if (cancelled) return;
        if (route === '/create-profile') {
          setProfileGate('need-profile');
          router.replace('/create-profile');
          return;
        }
        setProfileGate('ok');
      } catch {
        const local = await getLocalProfile(normalizeEmail(user.email));
        if (cancelled) return;
        if (!isLocalProfileComplete(local)) {
          setProfileGate('need-profile');
          router.replace('/create-profile');
          return;
        }
        setProfileGate('ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, sessionVersion, router]);

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

  if (user && profileGate !== 'ok') {
    return null;
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
