import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { getAuthToken } from '../../utils/auth';
import { apiRequest } from '../../utils/api';

export default function TabLayout() {
  const { sessionVersion } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const fetchUnread = async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const data: any = await apiRequest('/api/chat/unread-count', token);
        if (data && typeof data.unread === 'number') {
          setUnreadCount(data.unread);
        }
      } catch (e) {
        // silently ignore error if not logged in or backend unavailable
      }
    };

    fetchUnread();
    interval = setInterval(fetchUnread, 5000); // Poll every 5s

    return () => clearInterval(interval);
  }, [sessionVersion]);

  return (
    <Tabs
      key={`tabs-${sessionVersion}`}
      screenOptions={{
        tabBarActiveTintColor: '#8E2DE2',
        tabBarInactiveTintColor: '#999',
        headerShown: false,
        tabBarHideOnKeyboard: true,
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
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: { backgroundColor: '#8E2DE2', color: '#fff' },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="token"
        options={{
          title: 'Tokens',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'diamond' : 'diamond-outline'} size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={28} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
