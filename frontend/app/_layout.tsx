// Must stay first: registers LogBox filters before expo-notifications loads
import '../utils/logbox';
// Background FCM → local Answer/Decline trays (must register before React)
import '../utils/pushBackground';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { enableFreeze } from 'react-native-screens';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
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
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={stackScreenOptions}>
        <Stack.Screen name="index" options={instantScreenOptions} />
        <Stack.Screen
          name="(tabs)"
          options={{
            ...fadeScreenOptions,
            freezeOnBlur: false,
          }}
        />
        <Stack.Screen name="welcome" options={fadeScreenOptions} />
        <Stack.Screen name="login" options={instantScreenOptions} />
        <Stack.Screen
          name="otp"
          options={{
            ...instantScreenOptions,
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
        <Stack.Screen name="create-profile" options={fadeScreenOptions} />
        <Stack.Screen
          name="enable-location"
          options={{
            ...fadeScreenOptions,
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
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
        <Stack.Screen name="photo-verify" options={stackScreenOptions} />
        <Stack.Screen name="refer" options={stackScreenOptions} />
        <Stack.Screen name="safety-center" options={stackScreenOptions} />
        <Stack.Screen name="notifications" options={stackScreenOptions} />
        <Stack.Screen name="calls" options={stackScreenOptions} />
        <Stack.Screen name="subscription" options={stackScreenOptions} />
        <Stack.Screen name="subscription-terms" options={stackScreenOptions} />
        <Stack.Screen
          name="u/[publicId]"
          options={{
            ...fadeScreenOptions,
            presentation: 'transparentModal',
            animation: 'fade',
          }}
        />
        <Stack.Screen
          name="profile/[id]"
          options={{
            ...fadeScreenOptions,
            presentation: 'transparentModal',
            animation: 'fade',
          }}
        />
        <Stack.Screen
          name="r/[code]"
          options={{
            ...fadeScreenOptions,
            animation: 'fade',
          }}
        />
        <Stack.Screen
          name="go/[slug]"
          options={{
            ...fadeScreenOptions,
            animation: 'fade',
          }}
        />
      </Stack>
      <CallOverlay />
      <ExploreCallOverlay />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

/**
 * Any render error below the root used to close the whole app in release
 * builds. Show a recovery screen instead. Must not use app contexts — the
 * error may have come from one of them.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  React.useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    console.error('[App] render error:', error?.message || error);
  }, [error]);
  return (
    <View style={errorStyles.root}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.body}>
        Luvstor hit a problem loading this screen. Tap below to try again.
      </Text>
      <TouchableOpacity
        style={errorStyles.btn}
        activeOpacity={0.85}
        onPress={() => void retry()}
      >
        <Text style={errorStyles.btnText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#FDF8FF',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1B1F',
    textAlign: 'center',
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: '#49454F',
    textAlign: 'center',
  },
  btn: {
    marginTop: 22,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#6750A4',
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

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
