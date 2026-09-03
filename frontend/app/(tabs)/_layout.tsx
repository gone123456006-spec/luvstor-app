import React, { useEffect, useRef, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { tabScreenOptions } from '../../utils/navigation';
import { getAuthToken } from '../../utils/auth';
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
  const { sessionVersion, user } = useAuth();
  const { unreadCount, refreshUnread } = useSocket();
  const hadUserRef = useRef(false);

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

  useEffect(() => {
    refreshUnread();
  }, [sessionVersion, refreshUnread]);

  useEffect(() => {
    if (!user) {
      clearTokenBalanceCache();
      clearProfileCache();
      return;
    }
    (async () => {
      const token = await getAuthToken();
      if (token) {
        void preloadTokenBalance(token);
        void pingAppOpen(token).catch(() => {});
      }
      void preloadProfile();
    })();
  }, [user, sessionVersion]);

  return (
    <Tabs
      key={`tabs-${sessionVersion}`}
      screenOptions={{
        ...tabScreenOptions,
        tabBarActiveTintColor: '#8E2DE2',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          elevation: 0,
          height: 65,
          paddingBottom: 10,
          backgroundColor: '#fff',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'flame' : 'flame-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          freezeOnBlur: false,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#111', color: '#fff' },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="token"
        options={{
          title: 'Tokens',
          lazy: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'diamond' : 'diamond-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          lazy: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={28} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
