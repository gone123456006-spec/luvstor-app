import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../utils/api';
import { getAuthToken } from '../../utils/auth';
import { getCachedProfile, preloadProfile } from '../../utils/profileCache';

const WA = {
  bg: '#F5F5F7',
  white: '#FFFFFF',
  text: '#1C1B1F',
  secondary: '#6B7280',
  border: '#E8E8ED',
  primary: '#370372',
  danger: '#FF4B6E',
  header: '#F5F5F7',
};

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

type LoginInfo = {
  email: string;
  name: string;
  authProvider: 'google' | 'email' | string;
};

export default function AccountSettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [info, setInfo] = useState<LoginInfo>({
    email: user?.email || '',
    name: user?.name || '',
    authProvider: 'email',
  });
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        setLoading(true);
        const cached = getCachedProfile();
        const base: LoginInfo = {
          email: String(user?.email || '').trim(),
          name: String(
            user?.name || cached?.profile?.name || '',
          ).trim(),
          authProvider: 'email',
        };
        if (!cancelled) setInfo(base);

        try {
          const token = await getAuthToken();
          if (!token) {
            if (!cancelled) setLoading(false);
            return;
          }
          const me: any = await apiRequest('/api/users/me', token);
          if (cancelled) return;
          setInfo({
            email: String(me?.email || base.email || '').trim(),
            name: String(me?.name || base.name || '').trim(),
            authProvider:
              me?.authProvider === 'google' ? 'google' : 'email',
          });
          void preloadProfile({ force: false });
        } catch {
          /* keep cached / auth values */
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [user?.email, user?.name]),
  );

  const isGoogle = info.authProvider === 'google';
  const displayName = info.name || '—';
  const displayEmail = info.email || '—';

  const onLogout = () => {
    Alert.alert('Log out?', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/login' as any);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={WA.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={WA.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Text style={styles.sectionHint}>Signed in with</Text>

        <View style={styles.listGroup}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={WA.primary} />
            </View>
          ) : (
            <>
              <View style={styles.infoRow}>
                <View
                  style={[
                    styles.iconCircle,
                    {
                      backgroundColor: isGoogle ? '#FFFFFF' : WA.primary,
                      borderWidth: isGoogle ? 1 : 0,
                      borderColor: WA.border,
                    },
                  ]}
                >
                  {isGoogle ? (
                    <GoogleG size={18} />
                  ) : (
                    <Ionicons name="mail" size={20} color="#fff" />
                  )}
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>
                    {isGoogle ? 'Google account' : 'Email login'}
                  </Text>
                  <Text style={styles.rowSub}>
                    {isGoogle
                      ? 'You signed in with Google'
                      : 'You signed in with email OTP'}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={[styles.iconCircle, { backgroundColor: '#370372' }]}>
                  <Ionicons name="person" size={20} color="#fff" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>Name</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={[styles.iconCircle, { backgroundColor: '#4285F4' }]}>
                  <Ionicons name="mail-outline" size={20} color="#fff" />
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>
                    {isGoogle ? 'Google email' : 'Login email'}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {displayEmail}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionHint}>Legal & Privacy</Text>
        <View style={styles.listGroup}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/privacy-policy' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#4285F4' }]}>
              <Ionicons name="shield-checkmark" size={20} color="#fff" />
            </View>
            <Text style={styles.rowLabelFlex}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/terms-conditions' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#34A853' }]}>
              <Ionicons name="document-text" size={20} color="#fff" />
            </View>
            <Text style={styles.rowLabelFlex}>Terms & Conditions</Text>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/account-deletion' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#EA4335' }]}>
              <Ionicons name="information-circle" size={20} color="#fff" />
            </View>
            <Text style={styles.rowLabelFlex}>Account Deletion Policy</Text>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHint}>About</Text>
        <View style={styles.listGroup}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/app-version' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: '#370372' }]}>
              <Ionicons name="phone-portrait-outline" size={20} color="#fff" />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>App version</Text>
              <Text style={styles.rowSub}>Version, build & platform info</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHint}>Session</Text>
        <View style={styles.listGroup}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={onLogout}
          >
            <View style={[styles.iconCircle, { backgroundColor: WA.danger }]}>
              <Ionicons name="log-out" size={20} color="#fff" />
            </View>
            <Text style={[styles.rowLabelFlex, { color: WA.danger }]}>
              Logout
            </Text>
            <Ionicons name="chevron-forward" size={18} color={WA.secondary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionHint, { paddingTop: 28 }]}>
          Deleting your account will permanently remove your profile and data from Luvstor.
        </Text>

        <View style={styles.listGroup}>
          <TouchableOpacity
            style={styles.listRow}
            activeOpacity={0.7}
            onPress={() => router.push('/delete-account/warning' as any)}
          >
            <View style={[styles.iconCircle, { backgroundColor: WA.danger }]}>
              <Ionicons name="trash" size={20} color="#fff" />
            </View>
            <Text style={[styles.rowLabelFlex, { color: WA.danger }]}>
              Delete account
            </Text>
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
    backgroundColor: '#EFE8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: WA.text },
  scroll: { paddingBottom: 40, paddingTop: 4 },
  sectionHint: {
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
    marginLeft: 72,
  },
  loadingRow: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 16,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
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
  rowLabel: { fontSize: 17, fontWeight: '400', color: WA.text },
  rowLabelFlex: { flex: 1, fontSize: 17, fontWeight: '400' },
  rowSub: { fontSize: 13, color: WA.secondary, marginTop: 2 },
});
