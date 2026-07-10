import React, { useState, useRef } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { signInWithGoogle } from '../../lib/googleAuth';
import { mapAuthError } from '../../lib/authErrors';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation, route }: Props) {
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (err) setError(mapAuthError(err.message).message);
  }

  async function handleForgot() {
    if (!resetEmail.trim()) { setError('Enter your email address.'); return; }
    setResetLoading(true);
    setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: 'capsule://reset-password',
    });
    setResetLoading(false);
    if (err) { setError(err.message); return; }
    setResetSent(true);
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError('');
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
    setGoogleLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Your capsules are waiting</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#555"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <View style={styles.passwordRow}>
            <TextInput
              ref={passwordRef}
              style={[styles.input, styles.passwordInput]}
              placeholder="Password"
              placeholderTextColor="#555"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textContentType="password"
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(s => !s)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              hitSlop={8}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888888" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <LoadingBrand size="small" color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!showForgot ? (
          <TouchableOpacity onPress={() => { setShowForgot(true); setError(''); }}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        ) : resetSent ? (
          <View style={styles.resetSuccess}>
            <Text style={styles.resetSuccessText}>Check your email for a reset link.</Text>
            <TouchableOpacity onPress={() => { setShowForgot(false); setResetSent(false); setResetEmail(''); }}>
              <Text style={styles.link}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.forgotForm}>
            <TextInput
              style={styles.input}
              placeholder="Your email address"
              placeholderTextColor="#555"
              value={resetEmail}
              onChangeText={setResetEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />
            <TouchableOpacity style={styles.resetButton} onPress={handleForgot} disabled={resetLoading}>
              {resetLoading ? <LoadingBrand size="small" color="#fff" /> : <Text style={styles.buttonText}>Send Reset Link</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowForgot(false); setError(''); }}>
              <Text style={styles.forgotText}>Back to sign in</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.googleButton} onPress={handleGoogle} disabled={googleLoading}>
          {googleLoading ? (
            <LoadingBrand size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="logo-google" size={20} color="#FFFFFF" />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.switchText}>No account? <Text style={styles.link}>Create one</Text></Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 16 },
  back: { paddingVertical: 8 },
  backText: { color: '#FF6B35', fontSize: 16 },
  title: { fontSize: 32, fontWeight: '800', color: '#FFFFFF', marginTop: 16 },
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
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 14, padding: 4 },
  button: {
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  switchText: { color: '#888888', textAlign: 'center', fontSize: 15 },
  link: { color: '#FF6B35', fontWeight: '600' },
  error: { color: '#FF3B30', fontSize: 14, textAlign: 'center' },
  forgotText: { color: '#888888', fontSize: 14, textAlign: 'center' },
  forgotForm: { gap: 12 },
  resetButton: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FF6B35',
  },
  resetSuccess: { gap: 8, alignItems: 'center' },
  resetSuccessText: { color: '#30D158', fontSize: 14, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2A2A2A' },
  dividerText: { color: '#555555', fontSize: 14 },
  googleButton: {
    backgroundColor: '#4285F4',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  googleButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
