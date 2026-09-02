import { Stack } from 'expo-router';
import { stackScreenOptions } from '../../utils/navigation';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="account" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}
