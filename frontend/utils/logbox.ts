/**
 * Dev-only log filtering.
 *
 * Imported first from app/_layout so any leftover Expo Go push warnings
 * are ignored if a native module still logs them.
 */
import { LogBox } from 'react-native';

if (__DEV__) {
  LogBox.ignoreLogs([
    'expo-notifications: Android Push notifications (remote notifications)',
    '`expo-notifications` functionality is not fully supported in Expo Go',
  ]);
}
