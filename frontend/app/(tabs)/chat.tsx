import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { useRouter } from 'expo-router';

const CHATS = [
  {
    id: '1',
    name: 'Sarah',
    lastMessage: 'Hey! How are you doing today?',
    time: '2m ago',
    image: require('../../assets/images/girls-image.png'),
    unread: 2,
  },
  {
    id: '2',
    name: 'Alex',
    lastMessage: 'That sounds like a great plan!',
    time: '1h ago',
    image: require('../../assets/images/boy-image.png'),
    unread: 0,
  },
];

export default function ChatScreen() {
  const router = useRouter();

  const renderItem = ({ item }: { item: typeof CHATS[0] }) => (
    <TouchableOpacity 
      style={styles.chatItem}
      onPress={() => router.push({
        pathname: '/messages/[id]',
        params: { id: item.id, name: item.name }
      })}
    >
      <View style={styles.imageContainer}>
        <Image source={item.image} style={styles.avatar} contentFit="cover" />
        <View style={styles.onlineStatus} />
      </View>
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={styles.chatName}>{item.name}</Text>
          <Text style={styles.chatTime}>{item.time}</Text>
        </View>
        <View style={styles.messageRow}>
          <Text style={styles.lastMessage} numberOfLines={1}>{item.lastMessage}</Text>
          {item.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image 
          source={require('../../assets/images/luvstoer logo.png')} 
          style={styles.headerLogo} 
          contentFit="contain" 
        />
        <TouchableOpacity style={styles.iconBtn}>
          <Ionicons name="search-outline" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <View style={styles.matchesSection}>
        <Text style={styles.sectionTitle}>New Matches</Text>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CHATS}
          keyExtractor={(item) => `match-${item.id}`}
          contentContainerStyle={styles.matchesList}
          renderItem={({ item }: { item: typeof CHATS[0] }) => (
            <TouchableOpacity style={styles.matchItem}>
              <Image source={item.image} style={styles.matchAvatar} contentFit="cover" />
              <Text style={styles.matchName}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <FlatList
        data={CHATS}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Text style={styles.sectionTitle}>Conversations</Text>}
        ListHeaderComponentStyle={{ paddingHorizontal: 20, marginBottom: 10, marginTop: 10 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerLogo: {
    width: 90,
    height: 30,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchesSection: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  matchesList: {
    paddingLeft: 20,
    paddingBottom: 10,
  },
  matchItem: {
    alignItems: 'center',
    marginRight: 20,
  },
  matchAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
    borderColor: '#8E2DE2',
  },
  matchName: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  listContent: {
    paddingBottom: 100,
  },
  chatItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 15,
    alignItems: 'center',
  },
  imageContainer: {
    position: 'relative',
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f5f5f5',
  },
  onlineStatus: {
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
  chatInfo: {
    flex: 1,
    marginLeft: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    paddingBottom: 15,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  chatTime: {
    fontSize: 12,
    color: '#999',
  },
  messageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
  },
  lastMessage: {
    fontSize: 14,
    color: '#666',
    flex: 1,
    marginRight: 10,
  },
  unreadBadge: {
    backgroundColor: '#8E2DE2',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
