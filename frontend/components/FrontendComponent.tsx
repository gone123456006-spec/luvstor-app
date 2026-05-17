import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function FrontendComponent() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>This is the frontend component!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    margin: 10,
  },
  text: {
    fontSize: 16,
    color: '#333',
    fontWeight: 'bold',
  },
});
