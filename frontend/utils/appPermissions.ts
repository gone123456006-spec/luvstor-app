/**
 * In-app Android/iOS permission helpers for Settings → Permissions.
 * Requests use the system dialog (never deep-link to Settings unless permanently denied).
 */
import { Platform, PermissionsAndroid } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import * as Notifications from 'expo-notifications';

export type PermStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type AppPermissionId =
  | 'microphone'
  | 'camera'
  | 'photos'
  | 'music'
  | 'notifications'
  | 'calls';

function androidGranted(result: string | undefined | null): boolean {
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

async function androidCheck(permission: string): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(permission as any);
  } catch {
    return false;
  }
}

async function androidRequest(permission: string): Promise<boolean> {
  try {
    const result = await PermissionsAndroid.request(permission as any);
    return androidGranted(result);
  } catch {
    return false;
  }
}

function expoGranted(result: { granted?: boolean; status?: string } | null): boolean {
  return (
    result?.granted === true ||
    result?.status === 'granted' ||
    String(result?.status || '').toLowerCase() === 'granted'
  );
}

export async function getMicrophoneStatus(): Promise<PermStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const cur = await getRecordingPermissionsAsync();
    if (expoGranted(cur)) return 'granted';
    if (Platform.OS === 'android') {
      const ok = await androidCheck(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return ok ? 'granted' : 'denied';
    }
    return cur?.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestMicrophone(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const next = await requestRecordingPermissionsAsync();
    if (expoGranted(next)) return true;
  } catch {
    /* fall through */
  }
  if (Platform.OS === 'android') {
    return androidRequest(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  }
  return false;
}

export async function getCameraStatus(): Promise<PermStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const cur = await ImagePicker.getCameraPermissionsAsync();
    if (expoGranted(cur)) return 'granted';
    if (Platform.OS === 'android') {
      const ok = await androidCheck(PermissionsAndroid.PERMISSIONS.CAMERA);
      return ok ? 'granted' : 'denied';
    }
    return cur?.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestCamera(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const next = await ImagePicker.requestCameraPermissionsAsync();
    if (expoGranted(next)) return true;
  } catch {
    /* fall through */
  }
  if (Platform.OS === 'android') {
    return androidRequest(PermissionsAndroid.PERMISSIONS.CAMERA);
  }
  return false;
}

/** Photos & videos (Images and video) */
export async function getPhotosStatus(): Promise<PermStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (expoGranted(cur)) return 'granted';
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const img = await androidCheck(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      );
      const vid = await androidCheck(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      );
      if (img || vid) return 'granted';
      return 'denied';
    }
    return cur?.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestPhotos(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const next = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (expoGranted(next)) return true;
  } catch {
    /* fall through */
  }
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) >= 33) {
      const img = await androidRequest(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      );
      const vid = await androidRequest(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      );
      return img || vid;
    }
    return androidRequest(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    );
  }
  return false;
}

/** Music and audio library */
export async function getMusicStatus(): Promise<PermStatus> {
  if (Platform.OS !== 'android') {
    // iOS has no separate music permission for our use case
    return 'unavailable';
  }
  try {
    if (Number(Platform.Version) >= 33) {
      const ok = await androidCheck(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
      );
      return ok ? 'granted' : 'denied';
    }
    const ok = await androidCheck(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    );
    return ok ? 'granted' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function requestMusic(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) >= 33) {
    return androidRequest(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
  }
  return androidRequest(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
}

export async function getNotificationsStatus(): Promise<PermStatus> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (expoGranted(cur as any)) return 'granted';
    return (cur as any)?.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const ok = await androidRequest(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (ok) return true;
    }
    const next = await Notifications.requestPermissionsAsync();
    return expoGranted(next as any);
  } catch {
    return false;
  }
}

/** Android 12+ — required for Bluetooth SCO / communication-device routing. */
export async function requestBluetoothConnect(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return true;
  const perm = (PermissionsAndroid.PERMISSIONS as { BLUETOOTH_CONNECT?: string })
    .BLUETOOTH_CONNECT;
  if (!perm) return true;
  try {
    if (await androidCheck(perm)) return true;
    return androidRequest(perm);
  } catch {
    return false;
  }
}

/** Voice & video calls = microphone + camera (+ Bluetooth connect on Android 12+) */
export async function getCallsStatus(): Promise<PermStatus> {
  const mic = await getMicrophoneStatus();
  const cam = await getCameraStatus();
  if (mic === 'granted' && cam === 'granted') return 'granted';
  if (mic === 'granted' || cam === 'granted') return 'undetermined';
  return 'denied';
}

export async function requestCalls(): Promise<boolean> {
  const mic = await requestMicrophone();
  const cam = await requestCamera();
  await requestBluetoothConnect();
  return mic && cam;
}

export type PermissionSnapshot = Record<AppPermissionId, PermStatus>;

export async function getAllPermissionStatuses(): Promise<PermissionSnapshot> {
  const [microphone, camera, photos, music, notifications, calls] =
    await Promise.all([
      getMicrophoneStatus(),
      getCameraStatus(),
      getPhotosStatus(),
      getMusicStatus(),
      getNotificationsStatus(),
      getCallsStatus(),
    ]);
  return { microphone, camera, photos, music, notifications, calls };
}

export async function requestPermissionById(
  id: AppPermissionId,
): Promise<boolean> {
  switch (id) {
    case 'microphone':
      return requestMicrophone();
    case 'camera':
      return requestCamera();
    case 'photos':
      return requestPhotos();
    case 'music':
      return requestMusic();
    case 'notifications':
      return requestNotifications();
    case 'calls':
      return requestCalls();
    default:
      return false;
  }
}

/** Request the common set users expect for chat + calls (system dialogs only). */
export async function requestEssentialPermissions(): Promise<void> {
  await requestMicrophone();
  await requestCamera();
  await requestPhotos();
  if (Platform.OS === 'android') {
    await requestMusic();
    await requestBluetoothConnect();
  }
  await requestNotifications();
}
