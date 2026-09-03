import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest, getApiBase } from '../utils/api';
import { getAuthToken } from '../utils/auth';
import {
  fetchPhotoVerification,
  PhotoVerification,
  submitPhotoVerification,
} from '../utils/verification';

/**
 * Photo / selfie verification — separate from email isVerified
 * and from subscription blue tick.
 */
export default function PhotoVerifyScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<PhotoVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      const data = await fetchPhotoVerification(token);
      setStatus(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickAndSubmit = async () => {
    const token = await getAuthToken();
    if (!token) {
      Alert.alert('Sign in required');
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'Allow camera access to take a verification selfie.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (shot.canceled || !shot.assets?.[0]) return;

    const asset = shot.assets[0];
    setUploading(true);
    try {
      let url = '';
      if (asset.base64) {
        const uploaded = await apiRequest('/api/upload/image', token, {
          method: 'POST',
          body: JSON.stringify({
            image: `data:image/jpeg;base64,${asset.base64}`,
          }),
        });
        // Prefer relative /uploads/{userId}/… for ownership checks on the server
        url = uploaded?.url || uploaded?.absoluteUrl || '';
      }
      if (!url) throw new Error('Upload failed');
      const result = await submitPhotoVerification(token, url);
      setStatus(result);
      Alert.alert(
        'Submitted',
        result.message || 'Your selfie is pending review.',
      );
    } catch (err: any) {
      Alert.alert('Could not submit', err?.message || 'Try again.');
    } finally {
      setUploading(false);
    }
  };

  const label =
    status?.status === 'approved'
      ? 'Photo verified'
      : status?.status === 'pending'
        ? 'Pending review'
        : status?.status === 'rejected'
          ? 'Rejected — try again'
          : 'Not verified';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color="#1C1B1F" />
        </TouchableOpacity>
        <Text style={styles.title}>Photo verification</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#6750A4" />
      ) : (
        <View style={styles.body}>
          <View style={styles.badge}>
            <Ionicons
              name={status?.photoVerified ? 'shield-checkmark' : 'shield-outline'}
              size={40}
              color={status?.photoVerified ? '#0095F6' : '#6750A4'}
            />
          </View>
          <Text style={styles.heading}>{label}</Text>
          <Text style={styles.copy}>
            Take a clear selfie. This builds trust on Nearby and Explore. It is
            separate from email login and from subscription blue ticks.
          </Text>
          {status?.selfieUrl ? (
            <Image
              source={{
                uri: status.selfieUrl.startsWith('http')
                  ? status.selfieUrl
                  : `${getApiBase()}${status.selfieUrl}`,
              }}
              style={styles.preview}
              contentFit="cover"
            />
          ) : null}
          {status?.reviewNote ? (
            <Text style={styles.note}>Note: {status.reviewNote}</Text>
          ) : null}
          {status?.status !== 'approved' ? (
            <TouchableOpacity
              style={[styles.btn, uploading && { opacity: 0.6 }]}
              disabled={uploading}
              onPress={() => void pickAndSubmit()}
              activeOpacity={0.85}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>
                  {status?.status === 'pending' ? 'Retake selfie' : 'Take selfie'}
                </Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDF8FF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E7E0EC',
  },
  back: { padding: 6, marginRight: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#1C1B1F' },
  body: { padding: 24, alignItems: 'center' },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#EADDFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heading: { fontSize: 20, fontWeight: '700', color: '#1C1B1F', marginBottom: 8 },
  copy: {
    textAlign: 'center',
    color: '#49454F',
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  preview: {
    width: 160,
    height: 160,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: '#eee',
  },
  note: { color: '#B3261E', marginBottom: 12, textAlign: 'center' },
  btn: {
    marginTop: 8,
    backgroundColor: '#6750A4',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
