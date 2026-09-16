import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePublicId } from './profileLinks';

const PENDING_PROFILE_KEY = 'luvstor_pending_profile_id';

export async function setPendingProfileId(publicId: string | null) {
  const id = normalizePublicId(publicId);
  if (!id) {
    await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_PROFILE_KEY, id);
}

export async function consumePendingProfileId(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_PROFILE_KEY);
  await AsyncStorage.removeItem(PENDING_PROFILE_KEY);
  return normalizePublicId(raw);
}
