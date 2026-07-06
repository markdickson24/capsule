import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Props = {
  onRetry: () => void;
  message?: string;
  compact?: boolean;
};

// Shown in place of a spinner/skeleton once a loading state has taken too
// long (see useLoadingTimeout). Renders inline within the existing screen
// layout — not a modal/popup — so no card surface or backdrop.
export default function RetryPrompt({ onRetry, message = 'Taking longer than expected', compact = false }: Props) {
  const { accentColor } = useTheme();
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <Text style={[styles.message, compact && styles.messageCompact]}>{message}</Text>
      <TouchableOpacity
        style={[styles.button, compact && styles.buttonCompact]}
        onPress={onRetry}
        activeOpacity={0.7}
      >
        <Text style={[styles.buttonText, compact && styles.buttonTextCompact, { color: accentColor }]}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  containerCompact: {
    flex: 0,
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 10,
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    color: '#888888',
    textAlign: 'center',
  },
  messageCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  buttonCompact: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  buttonTextCompact: {
    fontSize: 14,
  },
});
