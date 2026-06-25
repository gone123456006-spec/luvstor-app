import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Animated, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import { getCurrentAuthUser, getLocalProfile, getAuthToken } from '../../utils/auth';
import { getAccountJson, setAccountJson, MATCHES_KEY } from '../../utils/accountStorage';
import { useAuth } from '../../contexts/AuthContext';
import { fetchNearbyUsers, NearbyUser } from '../../utils/nearby';

const FALLBACK_AVATAR = require('../../assets/images/boy-image.png');
const GIRL_AVATAR = require('../../assets/images/girls-image.png');

export default function DiscoverScreen() {
  const router = useRouter();
  const { sessionVersion } = useAuth();

  const [profilePhoto, setProfilePhoto] = React.useState<string | null>(null);
  const [nearbyUsers, setNearbyUsers] = React.useState<NearbyUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [matchedIds, setMatchedIds] = React.useState<string[]>([]);

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(15)).current;

  // ── Entrance animation ──────────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
      ]).start();
      return () => {
        fadeAnim.setValue(0);
        slideAnim.setValue(15);
      };
    }, [])
  );

  // ── Load own profile photo ──────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      const load = async () => {
        try {
          const authUser = await getCurrentAuthUser();
          if (!authUser?.email) return;
          const parsed = await getLocalProfile(authUser.email);
          setProfilePhoto(parsed?.photo || null);
        } catch (e) {
          console.error('Failed to load profile', e);
        }
      };
      load();
    }, [sessionVersion])
  );

  // ── Load matches ────────────────────────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      const loadMatches = async () => {
        try {
          const authUser = await getCurrentAuthUser();
          if (!authUser?.email) { setMatchedIds([]); return; }
          const stored = await getAccountJson<string[]>(MATCHES_KEY, authUser.email);
          setMatchedIds(stored || []);
        } catch (e) {
          console.error('Failed to load matches', e);
        }
      };
      loadMatches();
    }, [sessionVersion])
  );

  // ── Fetch nearby users from backend ────────────────────────────
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const load = async () => {
        setLoading(true);
        setLocationError(null);
        try {
          const token = await getAuthToken();
          if (!token) {
            setLocationError('Please sign in to see nearby people.');
            setLoading(false);
            return;
          }
          const { users, error } = await fetchNearbyUsers(token, 50);
          if (cancelled) return;
          if (error) setLocationError(error);
          setNearbyUsers(users);
        } catch (e: any) {
          if (!cancelled) setLocationError(e?.message || 'Could not load nearby people.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => { cancelled = true; };
    }, [sessionVersion])
  );

  // ── Toggle heart/match ──────────────────────────────────────────
  const toggleMatch = async (id: string) => {
    try {
      const authUser = await getCurrentAuthUser();
      if (!authUser?.email) return;
      const stored = await getAccountJson<string[]>(MATCHES_KEY, authUser.email);
      let matches = stored || [];
      matches = matches.includes(id) ? matches.filter(m => m !== id) : [...matches, id];
      await setAccountJson(MATCHES_KEY, authUser.email, matches);
      setMatchedIds(matches);
    } catch (e) {
      console.error(e);
    }
  };

  // ── Render a user card ──────────────────────────────────────────
  const renderItem = ({ item }: { item: NearbyUser }) => (
    <TouchableOpacity
      style={styles.listItem}
      activeOpacity={0.7}
      onPress={() =>
        router.push({ pathname: '/messages/[id]', params: { id: item.id, name: item.name, photo: item.photo, gender: item.gender, isOnline: item.isOnline ? 'true' : 'false' } })
      }
    >
      <View style={styles.imageContainer}>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Image
            source={item.gender === 'Female' ? GIRL_AVATAR : FALLBACK_AVATAR}
            style={styles.avatar}
            contentFit="cover"
          />
        )}
        {item.isOnline && <View style={styles.onlineStatus} />}
      </View>

      <View style={styles.textContainer}>
        <View style={styles.nameRow}>
          <Text style={styles.nameText}>
            {item.name}{item.age ? `, ${item.age}` : ''}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#CCC" />
        </View>
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color="#666" />
          <Text style={styles.locationText}>
            {item.distanceKm} km away{item.isOnline ? ' · online' : ''}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.matchBtn}
        onPress={() => toggleMatch(item.id)}
        activeOpacity={0.7}
      >
        <Ionicons
          name={matchedIds.includes(item.id) ? 'heart' : 'heart-outline'}
          size={26}
          color="#FF4B6E"
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ── Empty / error / loading states ────────────────────────────
  const ListEmpty = () => {
    if (loading) return null;
    if (locationError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="location-outline" size={48} color="#CCC" />
          <Text style={styles.emptyTitle}>Location Needed</Text>
          <Text style={styles.emptyText}>{locationError}</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="people-outline" size={48} color="#CCC" />
        <Text style={styles.emptyTitle}>No One Nearby</Text>
        <Text style={styles.emptyText}>
          No verified users found within 50 km. Check back later!
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />

        <LinearGradient
          colors={['#FFFFFF', '#FDF8FF', '#F5E6FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Image
              source={require('../../assets/images/luvstoer logo.png')}
              style={[styles.headerLogo, { tintColor: '#6750A4' }]}
              contentFit="contain"
            />
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.filterButton}>
              <Ionicons name="search-outline" size={20} color="#FF4B6E" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileBtn}>
              {profilePhoto ? (
                <Image source={{ uri: profilePhoto }} style={styles.headerAvatar} contentFit="cover" />
              ) : (
                <Image source={FALLBACK_AVATAR} style={styles.headerAvatar} contentFit="cover" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── List ── */}
        <FlatList
          data={nearbyUsers}
          extraData={matchedIds}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={ListEmpty}
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Nearby People</Text>
              {loading ? (
                <ActivityIndicator size="small" color="#7C3AED" />
              ) : (
                <Text style={styles.countText}>{nearbyUsers.length} found</Text>
              )}
            </View>
          }
        />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    backgroundColor: '#fff',
  },
  headerTitleContainer: { flex: 1 },
  headerLogo: { width: 100, height: 35, marginLeft: -5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filterButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFF0F2',
    justifyContent: 'center', alignItems: 'center',
  },
  profileBtn: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: '#FFF0F2', overflow: 'hidden',
  },
  headerAvatar: { width: '100%', height: '100%' },
  listContent: { paddingBottom: 100 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: 'transparent',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#444' },
  countText: { fontSize: 12, color: '#999', fontWeight: '500' },
  listItem: {
    flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center',
  },
  imageContainer: { position: 'relative' },
  avatar: { width: 65, height: 65, borderRadius: 32.5, backgroundColor: '#F5F5F5' },
  onlineStatus: {
    position: 'absolute', bottom: 2, right: 2,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#fff',
  },
  textContainer: { flex: 1, marginLeft: 15, justifyContent: 'center' },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameText: { fontSize: 18, fontWeight: '700', color: '#222' },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  locationText: { fontSize: 14, color: '#666', marginLeft: 4 },
  matchBtn: { padding: 8, marginLeft: 10, justifyContent: 'center', alignItems: 'center' },
  separator: { height: 1, backgroundColor: '#F0F0F0', marginLeft: 100 },
  emptyContainer: {
    alignItems: 'center', justifyContent: 'center',
    paddingTop: 60, paddingHorizontal: 40, gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#555', marginTop: 8 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },
});
