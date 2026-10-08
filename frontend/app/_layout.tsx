// Must stay first: registers LogBox filters before expo-notifications loads
import '../utils/logbox';
// Background FCM → local Answer/Decline trays (must register before React)
import '../utils/pushBackground';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  FadeOut,
  ReducedMotionConfig,
  ReduceMotion,
} from 'react-native-reanimated';
import { enableFreeze } from 'react-native-screens';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import {
  AccessibilityProvider,
  useAccessibility,
} from '../contexts/AccessibilityContext';
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
import { D, tc } from '../utils/theme';

const navDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: D.page,
    card: D.surface,
    border: D.line,
    text: D.text,
    primary: D.primary,
  },
};

type ScreenOptions = Exclude<
  React.ComponentProps<typeof Stack.Screen>['options'],
  undefined | ((...args: never[]) => unknown)
>;

SplashScreen.preventAutoHideAsync().catch(() => {});
enableFreeze(true);

function RootLayoutContent() {
  const { reduceMotion, uiKey, returnTo, isDark, restoring, finishRestore } =
    useAccessibility();
  const router = useRouter();

  // App-wide style change remounts the navigator — bring the user back without
  // any visible slide: screens are covered and transitions are off until done
  React.useEffect(() => {
    if (!uiKey || !returnTo) return;
    const push = setTimeout(() => router.push(returnTo as any), 600);
    const reveal = setTimeout(finishRestore, 950);
    return () => {
      clearTimeout(push);
      clearTimeout(reveal);
    };
  }, [uiKey, returnTo, router, finishRestore]);

  const m = (opts: ScreenOptions): ScreenOptions =>
    reduceMotion || restoring ? { ...opts, animation: 'none' } : opts;
  return (
    <ThemeProvider value={isDark ? navDarkTheme : DefaultTheme}>
      <Stack key={uiKey} screenOptions={m(stackScreenOptions)}>
        <Stack.Screen name="index" options={m(instantScreenOptions)} />
        <Stack.Screen
          name="(tabs)"
          options={m({
            ...fadeScreenOptions,
            freezeOnBlur: false,
          })}
        />
        <Stack.Screen name="welcome" options={m(fadeScreenOptions)} />
        <Stack.Screen name="login" options={m(instantScreenOptions)} />
        <Stack.Screen
          name="otp"
          options={m({
            ...instantScreenOptions,
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          })}
        />
        <Stack.Screen name="create-profile" options={m(fadeScreenOptions)} />
        <Stack.Screen
          name="enable-location"
          options={m({
            ...fadeScreenOptions,
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          })}
        />
        <Stack.Screen
          name="messages/[id]"
          options={m({
            ...stackScreenOptions,
            animationDuration: 280,
          })}
        />
        <Stack.Screen name="settings" options={m(stackScreenOptions)} />
        <Stack.Screen name="blocked" options={m(stackScreenOptions)} />
        <Stack.Screen name="delete-account" options={m(stackScreenOptions)} />
        <Stack.Screen name="help-support" options={m(stackScreenOptions)} />
        <Stack.Screen name="photo-verify" options={m(stackScreenOptions)} />
        <Stack.Screen name="refer" options={m(stackScreenOptions)} />
        <Stack.Screen name="safety-center" options={m(stackScreenOptions)} />
        <Stack.Screen name="notifications" options={m(stackScreenOptions)} />
        <Stack.Screen name="calls" options={m(stackScreenOptions)} />
        <Stack.Screen name="subscription" options={m(stackScreenOptions)} />
        <Stack.Screen name="subscription-terms" options={m(stackScreenOptions)} />
        <Stack.Screen
          name="u/[publicId]"
          options={m({
            ...fadeScreenOptions,
            presentation: 'transparentModal',
            animation: 'fade',
          })}
        />
        <Stack.Screen
          name="profile/[id]"
          options={m({
            ...fadeScreenOptions,
            presentation: 'transparentModal',
            animation: 'fade',
          })}
        />
        <Stack.Screen
          name="r/[code]"
          options={m({
            ...fadeScreenOptions,
            animation: 'fade',
          })}
        />
        <Stack.Screen
          name="go/[slug]"
          options={m({
            ...fadeScreenOptions,
            animation: 'fade',
          })}
        />
      </Stack>
      {restoring ? (
        <Animated.View
          exiting={FadeOut.duration(160)}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tc('#F5F5F7', 'bg') },
          ]}
        />
      ) : null}
      <ReducedMotionConfig
        mode={reduceMotion ? ReduceMotion.Always : ReduceMotion.Never}
      />
      <CallOverlay />
      <ExploreCallOverlay />
      <StatusBar style={isDark ? 'light' : 'dark'} />
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
    <AccessibilityProvider>
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
    </AccessibilityProvider>
  );
}
