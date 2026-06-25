import { Redirect } from 'expo-router';
import { useAuth } from './../contexts/AuthContext';
import { ActivityIndicator, View } from 'react-native';
import React, { useEffect, useState } from 'react';

export default function Index() {
  const { user, sessionVersion } = useAuth();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Wait briefly to allow AuthContext to load the session
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, [sessionVersion]);

  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1A0533', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#7C3AED" />
      </View>
    );
  }

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/welcome" />;
}
