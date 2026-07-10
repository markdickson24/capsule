import React, { useState, useEffect, useRef } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../types/navigation';
import { supabase } from '../../lib/supabase';
import { mapAuthError } from '../../lib/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
};

const RESEND_COOLDOWN_S = 60;

export default function SignUpScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorAction, setErrorAction] = useState<'signIn' | undefined>(undefined);

  // Set once signUp succeeds with no session (email confirmation required).
  // Replaces the form entirely — dead-ending on "check your email" with the
  // password field still filled in and a live "Create Account" button (a
  // second tap just yields a confusing "already registered" error) is the
  // single highest-stakes funnel step for a brand-new, zero-investment user.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown > 0]);

  async function handleSignUp() {
    setError('');
    setErrorAction(undefined);
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signUpError) {
      const mapped = mapAuthError(signUpError.message);
      setError(mapped.message);
      setErrorAction(mapped.action);
    } else if (data.session === null) {
      setPendingEmail(email.trim());
      setResendCooldown(RESEND_COOLDOWN_S);
    }
  }

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setResendMessage('');
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: pendingEmail,
    });
    setResendLoading(false);
    if (resendError) {
      setResendMessage("Couldn't resend — try again in a moment.");
    } else {
      setResendMessage('Confirmation email resent.');
      setResendCooldown(RESEND_COOLDOWN_S);
    }
  }

  if (pendingEmail) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.confirmWrap}>
          <View style={styles.confirmIconWrap}>
            <Ionicons name="mail-outline" size={40} color="#FF6B35" />
          </View>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.confirmSub}>We sent a confirmation link to</Text>
          <Text style={styles.confirmEmail}>{pendingEmail}</Text>
          <Text style={styles.confirmHint}>
            Tap the link in that email, then come back here and sign in.
          </Text>

          {resendMessage ? <Text style={styles.info}>{resendMessage}</Text> : null}

          <TouchableOpacity
            style={styles.button}
            onPress={() => navigation.navigate('Login', { email: pendingEmail })}
          >
            <Text style={styles.buttonText}>I've confirmed — Sign in</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} disabled={resendLoading || resendCooldown > 0}>
            {resendLoading ? (
              <LoadingBrand size="small" color="#FF6B35" />
            ) : (
              <Text style={[styles.link, resendCooldown > 0 && styles.linkDisabled]}>
                {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : 'Resend email'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Start locking memories</Text>

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
              textContentType="newPassword"
              autoComplete="new-password"
              returnKeyType="go"
              onSubmitEditing={handleSignUp}
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

        {error ? (
          <View style={styles.errorWrap}>
            <Text style={styles.error}>{error}</Text>
            {errorAction === 'signIn' && (
              <TouchableOpacity onPress={() => navigation.navigate('Login', { email: email.trim() })}>
                <Text style={styles.link}>Sign in instead</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <TouchableOpacity style={styles.button} onPress={handleSignUp} disabled={loading}>
          {loading ? (
            <LoadingBrand size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.switchText}>Already have an account? <Text style={styles.link}>Sign in</Text></Text>
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
  button: {
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  switchText: { color: '#888888', textAlign: 'center', fontSize: 15 },
  link: { color: '#FF6B35', fontWeight: '600', textAlign: 'center', fontSize: 15 },
  linkDisabled: { color: '#555555' },
  error: { color: '#FF3B30', textAlign: 'center', fontSize: 14 },
  errorWrap: { gap: 8 },
  info: { color: '#30D158', textAlign: 'center', fontSize: 14 },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 14, padding: 4 },
  confirmWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  confirmIconWrap: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#1A1A1A',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  confirmSub: { fontSize: 15, color: '#888888', marginTop: 4 },
  confirmEmail: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  confirmHint: { fontSize: 14, color: '#666666', textAlign: 'center', lineHeight: 20, marginBottom: 12 },
});
