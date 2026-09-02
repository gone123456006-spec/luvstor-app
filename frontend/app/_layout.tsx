// Must stay first: registers LogBox filters before expo-notifications loads
import '../utils/logbox';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { enableFreeze } from 'react-native-screens';
import { useColorScheme } from 'react-native';
import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../contexts/AuthContext';
import { SocketProvider } from '../contexts/SocketContext';
import { PushProvider } from '../contexts/PushContext';
import { CallProvider } from '../contexts/CallContext';
import { ExploreProvider } from '../contexts/ExploreContext';
import { AppAlertProvider } from '../components/AppAlert';
import CallOverlay from '../components/call/CallOverlay';
import ExploreCallOverlay from '../components/call/ExploreCallOverlay';
import {
  fadeScreenOptions,
  instantScreenOptions,
  stackScreenOptions,
} from '../utils/navigation';

SplashScreen.preventAutoHideAsync().catch(() => {});
enableFreeze(true);

function RootLayoutContent() {
  return (
    <ThemeProvider value={useColorScheme() === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" options={instantScreenOptions} />
        <Stack.Screen
          name="(tabs)"
          options={{
            ...fadeScreenOptions,
            freezeOnBlur: false,
          }}
        />
        <Stack.Screen name="welcome" options={stackScreenOptions} />
        <Stack.Screen name="login" options={stackScreenOptions} />
        <Stack.Screen
          name="otp"
          options={{
            ...stackScreenOptions,
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
        <Stack.Screen name="create-profile" options={stackScreenOptions} />
        <Stack.Screen
          name="messages/[id]"
          options={{
            ...stackScreenOptions,
            animationDuration: 280,
          }}
        />
        <Stack.Screen name="settings" options={stackScreenOptions} />
        <Stack.Screen name="blocked" options={stackScreenOptions} />
        <Stack.Screen name="delete-account" options={stackScreenOptions} />
        <Stack.Screen name="help-support" options={stackScreenOptions} />
        <Stack.Screen name="safety-center" options={stackScreenOptions} />
        <Stack.Screen name="notifications" options={stackScreenOptions} />
        <Stack.Screen name="calls" options={stackScreenOptions} />
        <Stack.Screen name="subscription" options={stackScreenOptions} />
        <Stack.Screen name="subscription-terms" options={stackScreenOptions} />
      </Stack>
      <CallOverlay />
      <ExploreCallOverlay />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SocketProvider>
        <PushProvider>
          <CallProvider>
            <ExploreProvider>
              <AppAlertProvider>
                <KeyboardProvider statusBarTranslucent navigationBarTranslucent preload>
                  <RootLayoutContent />
                </KeyboardProvider>
              </AppAlertProvider>
            </ExploreProvider>
          </CallProvider>
        </PushProvider>
      </SocketProvider>
    </AuthProvider>
  );
}
