import { Stack } from 'expo-router';
import { wizardScreenOptions } from '../../utils/navigation';

export default function DeleteAccountLayout() {
  return (
    <Stack screenOptions={wizardScreenOptions}>
      <Stack.Screen name="warning" />
      <Stack.Screen name="reason" />
      <Stack.Screen name="reflection" />
      <Stack.Screen name="confirmation" />
      <Stack.Screen name="final" />
    </Stack>
  );
}
