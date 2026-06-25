import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Animated, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { getCurrentAuthUser, getAuthToken } from '../../utils/auth';
import { useAuth } from '../../contexts/AuthContext';
import { formatChatListTime, useTimeTick } from '../../utils/timeFormat';
import { apiRequest, API_BASE } from '../../utils/api';

const FALLBACK_BOY = require('../../assets/images/boy-image.png');
const FALLBACK_GIRL = require('../../assets/images/girls-image.png');

export interface ConversationItem {
  otherId: string;
  name: string;
  photo: string;
  gender: string;
  isOnline: boolean;
  lastMessage: string;
  lastMessageAt: number;
  unread: number;
}

export default function ChatScreen() {
  const router = useRouter();
  const { sessionVersion } = useAuth();
  useTimeTick(60000);

  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeFilter, setActiveFilter] = React.useState('MyChat');
  const [searchQuery, setSearchQuery] = React.useState('');
  const FILTERS = ['MyChat', 'Online'];

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const slideAnim = React.useRef(new Animated.Value(15)).current;

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

  // ── Load real conversations from backend ────────────────────────
  const loadConversations = React.useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) { setLoading(false); return; }

      // GET /api/chat/conversations returns rooms with last message + other user info
      const data: any[] = await apiRequest('/api/chat/conversations', token);

      const authUser = await getCurrentAuthUser();
      const myId = authUser?.id;

      const items: ConversationItem[] = data.map((c: any) => {
        const msg = c.lastMessage;
        const otherId = String(msg.senderId) === myId
          ? String(msg.receiverId)
          : String(msg.senderId);

        const other = c.otherUser || {};
        return {
          otherId,
          name: other.name || 'User',
          photo: other.photo || '',
          gender: other.gender || '',
          isOnline: !!other.isOnline,
          lastMessage: msg.text || (msg.type === 'image' ? '📷 Photo' : '🎵 Voice'),
          lastMessageAt: new Date(msg.createdAt).getTime(),
          unread: c.unreadCount || 0,
        };
      });

      setConversations(items);
    } catch (e) {
      console.error('Failed to load conversations', e);
    } finally {
      setLoading(false);
    }
  }, [sessionVersion]);

  useFocusEffect(React.useCallback(() => {
    loadConversations();
  }, [loadConversations]));

  const goToChat = (otherId: string, name: string, photo: string, gender: string, isOnline: boolean) => {
    router.push({
      pathname: '/messages/[id]',
      params: { id: otherId, name, photo, gender, isOnline: isOnline ? 'true' : 'false' },
    });
  };

  const filtered = conversations
    .filter(c => {
      const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchFilter = activeFilter === 'Online' ? c.isOnline : true;
      return matchSearch && matchFilter;
    });

  const renderConversation = (item: ConversationItem) => (
    <TouchableOpacity
      key={item.otherId}
      style={styles.chatItem}
      activeOpacity={0.7}
      onPress={() => goToChat(item.otherId, item.name, item.photo, item.gender, item.isOnline)}
    >
      <View style={styles.avatarWrap}>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.avatar} contentFit="cover" />
        ) : (
          <Image
            source={item.gender === 'Female' ? FALLBACK_GIRL : FALLBACK_BOY}
            style={styles.avatar}
            contentFit="cover"
          />
        )}
        {item.isOnline && <View style={styles.onlineStatusDot} />}
      </View>

      <View style={styles.chatInfo}>
        <View style={styles.chatRow}>
          <Text style={styles.chatName}>{item.name}</Text>
          <Text style={styles.chatTime}>
            {formatChatListTime(item.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.chatRow}>
          <Text
            style={[styles.lastMessage, item.unread > 0 && styles.lastMessageUnread]}
            numberOfLines={1}
          >
            {item.lastMessage}
          </Text>
          {item.unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Chats</Text>
        </View>

        {/* ── Search ── */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#888" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations"
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* ── Filters ── */}
        <View style={styles.filtersContainer}>
          <View style={styles.filtersRow}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, activeFilter === f && styles.filterPillActive]}
                onPress={() => setActiveFilter(f)}
              >
                <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
                  {f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Content ── */}
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#8E2DE2" />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="chatbubbles-outline" size={52} color="#DDD" />
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'No results' : activeFilter === 'Online' ? 'No one online' : 'No conversations yet'}
            </Text>
            <Text style={styles.emptyText}>
              {!searchQuery && activeFilter === 'MyChat'
                ? 'Find someone nearby and start chatting!'
                : ''}
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
            <View style={styles.conversationsSection}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>
                  {activeFilter === 'Online' ? 'Online Now' : 'Conversations'}
                </Text>
                <Text style={styles.sectionCount}>{filtered.length} active</Text>
              </View>
              {filtered.map(renderConversation)}
            </View>
          </ScrollView>
        )}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    paddingHorizontal: 20, paddingTop: 15, paddingBottom: 15, backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 34, fontWeight: '800', color: '#000' },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F5F5F5', marginHorizontal: 20,
    paddingHorizontal: 12, height: 46, borderRadius: 23, marginBottom: 15,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 16, color: '#333' },
  filtersContainer: { marginBottom: 15 },
  filtersRow: {
    flexDirection: 'row', paddingHorizontal: 20, gap: 8,
  },
  filterPill: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#E0E0E0', backgroundColor: '#fff',
  },
  filterPillActive: { backgroundColor: '#F3E5F5', borderColor: '#CE93D8' },
  filterText: { fontSize: 14, fontWeight: '600', color: '#666' },
  filterTextActive: { color: '#8E2DE2' },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#666', marginTop: 10 },
  emptyText: { fontSize: 14, color: '#AAA', textAlign: 'center', paddingHorizontal: 40 },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#1a1a1a' },
  sectionCount: { fontSize: 12, color: '#999', fontWeight: '600' },
  conversationsSection: { marginTop: 10 },
  chatItem: {
    flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 14,
    alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#f5f5f5' },
  onlineStatusDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 13, height: 13, borderRadius: 6.5,
    backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#fff',
  },
  chatInfo: { flex: 1, marginLeft: 14, gap: 5 },
  chatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  chatTime: { fontSize: 12, color: '#bbb', fontWeight: '500' },
  lastMessage: { fontSize: 13, color: '#888', flex: 1, marginRight: 10 },
  lastMessageUnread: { color: '#333', fontWeight: '600' },
  badge: {
    backgroundColor: '#8E2DE2', borderRadius: 10, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
