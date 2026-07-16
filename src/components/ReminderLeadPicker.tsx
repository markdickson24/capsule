import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { haptics } from '../lib/haptics';

const OPTIONS: { label: string; hours: number | null }[] = [
  { label: 'Off', hours: null },
  { label: '1 day', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
];

interface Props {
  value: number | null;
  onChange: (hours: number | null) => void;
}

export default function ReminderLeadPicker({ value, onChange }: Props) {
  const { accentColor } = useTheme();
  return (
    <View style={styles.row}>
      {OPTIONS.map(opt => {
        const active = value === opt.hours;
        return (
          <TouchableOpacity
            key={opt.label}
            style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
            onPress={() => { haptics.selection(); onChange(opt.hours); }}
          >
            <Text style={[styles.chipText, active && { color: accentColor }]} numberOfLines={1}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Always exactly 4 fixed, short-label options — same treatment as
  // CreateGroupScreen/ManageGroupScreen's recurrence row: equal flex share
  // per chip instead of sizing to text, so the row can't wrap.
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
});
