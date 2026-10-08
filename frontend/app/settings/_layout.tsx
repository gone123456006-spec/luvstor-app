import { Stack } from 'expo-router';
import { useAccessibility } from '../../contexts/AccessibilityContext';
import { stackScreenOptions } from '../../utils/navigation';

export default function SettingsLayout() {
  const { reduceMotion, restoring } = useAccessibility();
  return (
    <Stack
      screenOptions={
        reduceMotion || restoring
          ? { ...stackScreenOptions, animation: 'none' }
          : stackScreenOptions
      }
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="account" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="permissions" />
      <Stack.Screen name="accessibility" />
      <Stack.Screen name="chat-wallpaper" />
      <Stack.Screen name="app-version" />
      <Stack.Screen name="privacy-policy" />
      <Stack.Screen name="terms-conditions" />
      <Stack.Screen name="account-deletion" />
      <Stack.Screen name="account-control" />
      <Stack.Screen name="personal-details" />
      <Stack.Screen name="deactivation-deletion" />
    </Stack>
  );
}
