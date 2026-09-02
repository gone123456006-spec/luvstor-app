import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const WA = {
  bg: '#FDF8FF',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  primary: '#6750A4',
  header: '#FDF8FF',
};

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.listGroup}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/account' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: WA.primary }]}>
              <Ionicons name="person" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Account</Text>
              <Text style={styles.rowSub}>Manage your account settings</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/notifications' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#25D366' }]}>
              <Ionicons name="notifications" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Notifications</Text>
              <Text style={styles.rowSub}>Messages, matches, calls and more</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/calls' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#128C7E' }]}>
              <Ionicons name="call" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Calls</Text>
              <Text style={styles.rowSub}>Voice and video call history</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WA.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: WA.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: WA.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EADDFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  scroll: { paddingBottom: 40, paddingTop: 12 },
  listGroup: { backgroundColor: WA.white },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: WA.border,
    marginLeft: 72,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 16,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 17, color: WA.text, fontWeight: '400' },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
});
