import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../../types/navigation';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';

type Props = NativeStackScreenProps<AppStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen({ navigation }: Props) {
  const { accentColor } = useTheme();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleReset() {
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (err) { setError(err.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Password updated</Text>
          <Text style={styles.subtitle}>You're all set. Go ahead and use the app.</Text>
          <TouchableOpacity style={[styles.button, { backgroundColor: accentColor }]} onPress={() => navigation.replace('Tabs', undefined)}>
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.subtitle}>Choose something you'll remember.</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="New password"
            placeholderTextColor="#555"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor="#555"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.button, { backgroundColor: accentColor }]} onPress={handleReset} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update Password</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 48, gap: 16 },
  title: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 16, color: '#888888' },
  form: { gap: 12, marginTop: 8 },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  button: {
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
});
