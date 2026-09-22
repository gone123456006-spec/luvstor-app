import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiRequest } from '../utils/api';
import WhatsAppAvatar from './WhatsAppAvatar';

const PURPLE = '#370372';
const REFRESH_INTERVAL = 60000; // 1 minute

interface OnlineUser {
  id: string;
  name: string;
  photo: string;
  age: number;
  distanceKm: string;
  isOnline: boolean;
  photoVerified: boolean;
}

interface Props {
  token: string | null;
  onUserPress: (userId: string) => void;
  refreshTrigger?: number;
}

export function OnlineNearbyPulse({ token, onUserPress, refreshTrigger }: Props) {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOnlineNearby = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const result = await apiRequest('/api/users/online-nearby', token);
      
      if (result.error) {
        setError(result.error);
        setUsers([]);
      } else {
        setUsers(result.users || []);
        setError(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchOnlineNearby();
    
    // Auto-refresh every minute
    const interval = setInterval(fetchOnlineNearby, REFRESH_INTERVAL);
    
    return () => clearInterval(interval);
  }, [fetchOnlineNearby]);

  // Manual refresh trigger
  useEffect(() => {
    if (refreshTrigger) {
      fetchOnlineNearby();
    }
  }, [refreshTrigger, fetchOnlineNearby]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="radio" size={16} color={PURPLE} />
          <Text style={styles.headerText}>Online Nearby</Text>
        </View>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="small" color={PURPLE} />
        </View>
      </View>
    );
  }

  if (error || users.length === 0) {
    return null; // Hide if no online users
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.pulseDot} />
          <Text style={styles.headerText}>Online Nearby</Text>
          <Text style={styles.count}>{users.length}</Text>
        </View>
        <TouchableOpacity onPress={fetchOnlineNearby} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={18} color="#666" />
        </TouchableOpacity>
      </View>
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {users.map((user) => (
          <TouchableOpacity
            key={user.id}
            style={styles.userCard}
            onPress={() => onUserPress(user.id)}
            activeOpacity={0.7}
          >
            <View style={styles.avatarContainer}>
              <WhatsAppAvatar
                photo={user.photo}
                name={user.name}
                size={64}
              />
              <View style={styles.onlineBadge} />
              {user.photoVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="shield-checkmark" size={12} color="#fff" />
                </View>
              )}
            </View>
            <Text style={styles.userName} numberOfLines={1}>
              {user.name}, {user.age}
            </Text>
            <Text style={styles.distance} numberOfLines={1}>
              {user.distanceKm} km
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
  },
  headerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
    color: PURPLE,
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  loaderContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 12,
  },
  userCard: {
    alignItems: 'center',
    width: 80,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f0f0f0',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4CAF50',
    borderWidth: 2,
    borderColor: '#fff',
  },
  verifiedBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  distance: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
});
