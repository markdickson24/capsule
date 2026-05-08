import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function ProfileScreen() {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Sign out?</Text>
        <Text style={styles.subtitle}>You'll need to log back in to access your capsules.</Text>
        <View style={styles.row}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setConfirming(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <TouchableOpacity style={styles.signOutButton} onPress={() => setConfirming(true)}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 32 },
  title: { fontSize: 24, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#888888', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12 },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  signOutButton: { flex: 1, borderWidth: 1, borderColor: '#FF3B30', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: '#FF3B30', fontWeight: '600', fontSize: 16 },
});
