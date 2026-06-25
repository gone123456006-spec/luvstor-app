import * as Location from 'expo-location';
import { apiRequest } from './api';

export interface NearbyUser {
  id: string;
  name: string;
  age: number;
  bio: string;
  photo: string;
  gender: string;
  interests: string[];
  isOnline: boolean;
  distanceKm: string;
}

/**
 * Request location permission, get GPS coords, upload to backend,
 * then fetch & return the list of nearby users.
 */
export async function fetchNearbyUsers(
  token: string,
  radiusKm: number = 50
): Promise<{ users: NearbyUser[]; error?: string }> {
  try {
    // 1. Ask for foreground location permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return {
        users: [],
        error: 'Location permission denied. Enable it in Settings to see nearby people.',
      };
    }

    // 2. Get current position (fast, low accuracy is fine for matching)
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = position.coords;

    // 3. Upload my location to backend so others can find me
    await apiRequest('/api/users/location', token, {
      method: 'PUT',
      body: JSON.stringify({ latitude, longitude }),
    });

    // 4. Fetch nearby users within radius
    const radiusMetres = radiusKm * 1000;
    const data: any[] = await apiRequest(
      `/api/users/nearby?radius=${radiusMetres}`,
      token
    );

    const users: NearbyUser[] = data.map((u: any) => ({
      id: String(u.id || u._id),
      name: u.name || 'Unknown',
      age: u.age || 0,
      bio: u.bio || '',
      photo: u.photo || '',
      gender: u.gender || '',
      interests: u.interests || [],
      isOnline: !!u.isOnline,
      distanceKm: u.distanceKm || '?',
    }));

    return { users };
  } catch (err: any) {
    return {
      users: [],
      error: err?.message || 'Failed to load nearby people.',
    };
  }
}
