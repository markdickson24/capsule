import React, { useState, useEffect, useRef } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../types/navigation';
import { supabase } from '../../lib/supabase';
import { mapAuthError } from '../../lib/authErrors';
import { PRIVACY_URL, TERMS_URL } from '../../lib/legalLinks';

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

  // Email-OTP verification (the "Confirm signup" email carries a 6-digit code —
  // {{ .Token }} — not a link). verifyOtp returns a session on success, so the
  // user is signed straight in; useAuth's onAuthStateChange then swaps to the
  // AppNavigator → Onboarding, with no separate Login step.
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');

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
      // Supabase's anti-enumeration behavior: a session-less "success" for an
      // email that already belongs to a confirmed account comes back with an
      // obfuscated user whose `identities` array is empty (rather than the
      // "already registered" error a direct duplicate signUp would throw).
      // Route it through the same mapper/copy as that error path instead of
      // showing a "check your email" screen for an email that's never coming.
      if (data.user?.identities?.length === 0) {
        const mapped = mapAuthError('already registered');
        setError(mapped.message);
        setErrorAction(mapped.action);
      } else {
        setPendingEmail(email.trim());
        setResendCooldown(RESEND_COOLDOWN_S);
      }
    }
  }

  async function handleResend() {
    if (!pendingEmail || resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setResendMessage('');
    setVerifyError('');
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: pendingEmail,
    });
    setResendLoading(false);
    if (resendError) {
      setResendMessage("Couldn't resend — try again in a moment.");
    } else {
      setResendMessage('New code sent.');
      setResendCooldown(RESEND_COOLDOWN_S);
    }
  }

  // Verify the 6-digit signup code. On success verifyOtp sets the session, and
  // useAuth swaps AuthNavigator → AppNavigator automatically — no manual nav.
  async function handleVerify(code: string) {
    if (!pendingEmail || verifying || code.length !== 6) return;
    setVerifying(true);
    setVerifyError('');
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: code,
      type: 'signup',
    });
    if (verifyErr) {
      // Wrong/expired codes come back as "Token has expired or is invalid".
      setVerifyError('That code is invalid or expired. Check it, or resend a new one.');
      setOtp('');
      setVerifying(false);
    }
    // On success: leave `verifying` true — the screen unmounts as the session
    // lands, so flipping it back would just flash the button first.
  }

  function onOtpChange(text: string) {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 6);
    setOtp(digits);
    if (verifyError) setVerifyError('');
    // Auto-submit the moment 6 digits are present (typed or autofilled).
    if (digits.length === 6) handleVerify(digits);
  }

  if (pendingEmail) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.confirmWrap}>
          <View style={styles.confirmIconWrap}>
            <Ionicons name="mail-outline" size={40} color="#FC6A5B" />
          </View>
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.confirmSub}>We sent a 6-digit code to</Text>
          <Text style={styles.confirmEmail}>{pendingEmail}</Text>

          <TextInput
            style={[styles.codeInput, verifyError ? styles.codeInputError : null]}
            value={otp}
            onChangeText={onOtpChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            editable={!verifying}
            placeholder="••••••"
            placeholderTextColor="#333"
            accessibilityLabel="6-digit verification code"
            returnKeyType="done"
            onSubmitEditing={() => handleVerify(otp)}
          />

          {verifyError ? <Text style={styles.error}>{verifyError}</Text> : null}
          {resendMessage ? <Text style={styles.info}>{resendMessage}</Text> : null}

          <TouchableOpacity
            style={[styles.button, (verifying || otp.length !== 6) && styles.buttonDisabled]}
            onPress={() => handleVerify(otp)}
            disabled={verifying || otp.length !== 6}
          >
            {verifying ? (
              <LoadingBrand size="small" color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify &amp; continue</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} disabled={resendLoading || resendCooldown > 0}>
            {resendLoading ? (
              <LoadingBrand size="small" color="#FC6A5B" />
            ) : (
              <Text style={[styles.link, resendCooldown > 0 && styles.linkDisabled]}>
                {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => { setPendingEmail(null); setOtp(''); setVerifyError(''); setResendMessage(''); }}
            disabled={verifying}
          >
            <Text style={styles.useDifferent}>Use a different email</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
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

        <Text style={styles.consentText}>
          By creating an account you agree to our{' '}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(TERMS_URL)}>
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text style={styles.consentLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
            Privacy Policy
          </Text>
          .
        </Text>

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
  backText: { color: '#FC6A5B', fontSize: 16 },
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
    backgroundColor: '#FC6A5B',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  codeInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
    paddingVertical: 16,
    alignSelf: 'stretch',
    marginTop: 16,
    marginBottom: 4,
  },
  codeInputError: { borderColor: '#FF3B30' },
  useDifferent: { color: '#666666', fontWeight: '600', textAlign: 'center', fontSize: 14, marginTop: 4 },
  switchText: { color: '#888888', textAlign: 'center', fontSize: 15 },
  consentText: { color: '#888888', textAlign: 'center', fontSize: 12, lineHeight: 17 },
  consentLink: { color: '#FC6A5B', fontWeight: '600' },
  link: { color: '#FC6A5B', fontWeight: '600', textAlign: 'center', fontSize: 15 },
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
