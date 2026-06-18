import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Preset = { hours: number; label: string };

const PRESETS: Preset[] = [
  { hours: 24,  label: '1 day' },
  { hours: 48,  label: '2 days' },
  { hours: 168, label: '7 days' },
];

const MIN_HOURS = 1;
const MAX_HOURS = 720;

function describe(hours: number): string {
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  if (hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return `${hours} hours`;
}

type Props = {
  value: number;
  onChange: (hours: number) => void;
};

export default function VotingWindowPicker({ value, onChange }: Props) {
  const { accentColor } = useTheme();

  const presetMatch = useMemo(
    () => PRESETS.find(p => p.hours === value) ?? null,
    [value],
  );
  const [customSelected, setCustomSelected] = useState(presetMatch === null);
  const [customText, setCustomText] = useState(String(value));

  function selectPreset(p: Preset) {
    setCustomSelected(false);
    onChange(p.hours);
  }

  function selectCustom() {
    setCustomSelected(true);
    setCustomText(String(value));
  }

  function handleCustomChange(text: string) {
    setCustomText(text);
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= MIN_HOURS && n <= MAX_HOURS) {
      onChange(n);
    }
  }

  const valid = value >= MIN_HOURS && value <= MAX_HOURS;

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Awards Voting Window</Text>

      <View style={styles.row}>
        {PRESETS.map(p => {
          const selected = !customSelected && presetMatch?.hours === p.hours;
          return (
            <TouchableOpacity
              key={p.hours}
              style={[
                styles.chip,
                selected && [styles.chipSelected, { borderColor: accentColor, backgroundColor: `${accentColor}22` }],
              ]}
              onPress={() => selectPreset(p)}
            >
              <Text style={[styles.chipText, selected && { color: accentColor }]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[
            styles.chip,
            customSelected && [styles.chipSelected, { borderColor: accentColor, backgroundColor: `${accentColor}22` }],
          ]}
          onPress={selectCustom}
        >
          <Text style={[styles.chipText, customSelected && { color: accentColor }]}>Custom</Text>
        </TouchableOpacity>
      </View>

      {customSelected && (
        <View style={styles.customRow}>
          <TextInput
            style={[styles.customInput, !valid && styles.customInputInvalid]}
            value={customText}
            onChangeText={handleCustomChange}
            keyboardType="number-pad"
            maxLength={3}
            placeholder="48"
            placeholderTextColor="#555"
          />
          <Text style={styles.customLabel}>hours</Text>
        </View>
      )}

      <Text style={styles.hint}>
        Awards voting opens when this capsule unlocks and stays open for {describe(value)}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  label: { fontSize: 14, fontWeight: '600', color: '#AAAAAA', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A',
  },
  chipSelected: { borderColor: '#FF6B35', backgroundColor: '#2A1500' },
  chipText: { color: '#888888', fontWeight: '600', fontSize: 14 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customInput: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    width: 100,
    textAlign: 'center',
  },
  customInputInvalid: { borderColor: '#FF3B30' },
  customLabel: { color: '#888888', fontSize: 15 },
  hint: { fontSize: 13, color: '#888888' },
});
