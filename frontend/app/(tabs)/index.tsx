import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';

const MOCK_DATA = [
  {
    id: '1',
    name: 'Sarah',
    age: 24,
    location: 'San Francisco, CA',
    image: require('../../assets/images/girls-image.png'),
    online: true,
  },
  {
    id: '2',
    name: 'Alex',
    age: 27,
    location: 'New York, NY',
    image: require('../../assets/images/boy-image.png'),
    online: false,
  },
  {
    id: '3',
    name: 'Jessica',
    age: 22,
    location: 'Los Angeles, CA',
    image: require('../../assets/images/girls-image.png'),
    online: true,
  },
  {
    id: '4',
    name: 'Ryan',
    age: 29,
    location: 'Chicago, IL',
    image: require('../../assets/images/boy-image.png'),
    online: true,
  },
  {
    id: '5',
    name: 'Emily',
    age: 25,
    location: 'Miami, FL',
    image: require('../../assets/images/girls-image.png'),
    online: false,
  },
];

export default function DiscoverScreen() {
  const renderItem = ({ item }: { item: typeof MOCK_DATA[0] }) => (
    <TouchableOpacity style={styles.listItem} activeOpacity={0.7}>
      <View style={styles.imageContainer}>
        <Image source={item.image} style={styles.avatar} contentFit="cover" />
        {item.online && <View style={styles.onlineStatus} />}
      </View>
      
      <View style={styles.textContainer}>
        <View style={styles.nameRow}>
          <Text style={styles.nameText}>{item.name}, {item.age}</Text>
          <Ionicons name="chevron-forward" size={18} color="#CCC" />
        </View>
        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={14} color="#666" />
          <Text style={styles.locationText}>{item.location}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Image 
            source={require('../../assets/images/luvstoer logo.png')} 
            style={styles.headerLogo} 
            contentFit="contain" 
          />
          <Text style={styles.headerSubtitle}>Discover people around you</Text>
        </View>
        <TouchableOpacity style={styles.filterButton}>
          <Ionicons name="search-outline" size={22} color="#FF4B6E" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={MOCK_DATA}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Near By People</Text>
            <Text style={styles.countText}>{MOCK_DATA.length} found</Text>
          </View>
        }
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
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerLogo: {
    width: 100,
    height: 35,
    marginLeft: -5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: -2,
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF0F2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#F9F9F9',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#444',
  },
  countText: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
  },
  listItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 15,
    alignItems: 'center',
  },
  imageContainer: {
    position: 'relative',
  },
  avatar: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: '#F5F5F5',
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
  textContainer: {
    flex: 1,
    marginLeft: 15,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  nameText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  locationText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  separator: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginLeft: 100,
  },
});
