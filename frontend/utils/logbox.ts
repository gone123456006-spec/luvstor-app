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
    "expo-notifications: Custom sound 'default' not found",
  ]);
} else {
  // Release builds: chatty socket / chat logs cost JS time on low-end phones.
  // warn / error stay on for crash reports.
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}
