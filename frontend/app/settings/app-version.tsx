import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const C = {
  bg: '#F5F5F7',
  text: '#1C1B1F',
  secondary: '#49454F',
  border: '#E7E0EC',
  purple: '#370372',
  header: '#F5F5F7',
};

const LOGO = require('../../assets/images/luvstoer logo.png');

export default function AppVersionScreen() {
  const router = useRouter();

  const appVersion =
    Constants.expoConfig?.version ||
    Constants.nativeAppVersion ||
    '1.0.0';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={C.header} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App version</Text>
      </View>

      <View style={styles.center}>
        <Image
          source={LOGO}
          style={[styles.logo, { tintColor: C.purple }]}
          contentFit="contain"
        />
        <Text style={styles.version}>Version {appVersion}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: C.header,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFE8F8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '600', color: C.text },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  logo: {
    width: 180,
    height: 60,
    marginBottom: 16,
  },
  version: {
    fontSize: 16,
    fontWeight: '500',
    color: C.secondary,
  },
});
