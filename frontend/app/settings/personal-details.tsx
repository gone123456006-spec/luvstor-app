import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ListRowTouchable from '../../components/ListRowTouchable';
import { useAuth } from '../../contexts/AuthContext';
import { getCachedProfile } from '../../utils/profileCache';
import { NAV_ICON, SHOW_ROW_CHEVRON } from '../../utils/platformIcons';
import { statusBarStyle, themedPalette, themedStyles } from '../../utils/theme';

const WA = themedPalette({
  bg: '#F5F5F7',
  text: '#1C1B1F',
  secondary: '#6B7280',
  border: '#E8E8ED',
  header: '#F5F5F7',
});

export default function PersonalDetailsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const cached = getCachedProfile();
  const name = String(user?.name || cached?.profile?.name || '').trim() || '—';
  const email = String(user?.email || '').trim() || '—';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={statusBarStyle()} backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name={NAV_ICON.back} size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Personal details</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Luvstor uses this information to verify your identity and to keep our community safe.
        </Text>

        <View style={styles.listGroup}>
          <View style={styles.listRow}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Contact info</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {email}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.listRow}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {name}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <ListRowTouchable
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/account-control' as any)}
          >
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Account ownership and control</Text>
              <Text style={styles.rowSub}>
                Manage your data, deactivate or delete your account
              </Text>
            </View>
            {SHOW_ROW_CHEVRON ? (
              <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
            ) : null}
          </ListRowTouchable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
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
      backgroundColor: '#EFE8F8',
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: '600', color: WA.text },
    scroll: { paddingBottom: 40, paddingTop: 4 },
    intro: {
      fontSize: 14,
      color: WA.secondary,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 10,
      lineHeight: 20,
    },
    listGroup: { backgroundColor: WA.bg },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: WA.border,
      marginLeft: 20,
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 20,
      gap: 16,
    },
    rowContent: { flex: 1 },
    rowLabel: { fontSize: 17, fontWeight: '400', color: WA.text },
    rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
  }),
);
