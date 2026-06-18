import React, { useEffect, useState } from 'react';
import LoadingBrand from '../../components/LoadingBrand';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { signInWithGoogle } from '../../lib/googleAuth';
import { sessionStore } from '../../lib/sessionStore';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    sessionStore.consumeSessionExpired().then(setExpired);
  }, []);

  async function handleGoogle() {
    setGoogleLoading(true);
    setError('');
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
    setGoogleLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      {expired && (
        <View style={styles.expiredBanner}>
          <Ionicons name="lock-closed-outline" size={16} color="#FFB020" />
          <Text style={styles.expiredText}>Your session expired. Please sign in again.</Text>
          <TouchableOpacity onPress={() => setExpired(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={14} color="#FFB020" />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.hero}>
        <Ionicons name="time-outline" size={72} color="#FF6B35" />
        <Text style={styles.title}>Capsule</Text>
        <Text style={styles.subtitle}>Lock your memories.{'\n'}Unlock the moment.</Text>
      </View>

      <View style={styles.actions}>
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

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('SignUp')}>
          <Text style={styles.primaryButtonText}>Create Account</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.secondaryButtonText}>Sign In</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 18,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 26,
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#FF6B35',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333333',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#4285F4',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  googleButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  dividerText: {
    color: '#555555',
    fontSize: 14,
  },
  error: {
    color: '#FF3B30',
    fontSize: 14,
    textAlign: 'center',
  },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,176,32,0.12)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,176,32,0.35)',
  },
  expiredText: {
    flex: 1,
    color: '#FFD18A',
    fontSize: 13,
    fontWeight: '600',
  },
});
