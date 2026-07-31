import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MIN_LENGTH = 8;

// Single source of truth for the password policy shown here — must match
// the `password.length < MIN_LENGTH` submit-time guard in SignUpScreen and
// ResetPasswordScreen, and the Supabase Auth minimum password length setting
// (Dashboard → Authentication → Policies → Password Requirements). This is
// deliberately length-only, no character-class requirements.
export function isPasswordValid(password: string): boolean {
  return password.length >= MIN_LENGTH;
}

// Live checklist shown under a password field as the user types — replaces
// a submit-time-only error with immediate feedback. Currently a single row;
// built as an array so a future requirement (e.g. a character class) is a
// one-line addition, not a rewrite.
export default function PasswordRequirements({ password }: { password: string }) {
  const met = isPasswordValid(password);
  return (
    <View style={styles.row}>
      <Ionicons
        name={met ? 'checkmark-circle' : 'close-circle'}
        size={16}
        color={met ? '#30D158' : '#FF3B30'}
      />
      <Text style={[styles.label, { color: met ? '#30D158' : '#FF3B30' }]}>
        {MIN_LENGTH} characters minimum
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -4 },
  label: { fontSize: 13, fontWeight: '500' },
});
