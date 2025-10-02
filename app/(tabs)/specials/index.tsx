import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function SpecialsScreen() {
  return (
    <View style={styles.container}>
      <Text>🍇 Specials Screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
