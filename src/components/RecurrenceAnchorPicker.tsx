import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { RecurrenceAnchor } from '../lib/recurrence';
import { GroupRecurrence } from '../lib/groups';
import { useTheme } from '../context/ThemeContext';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
// UI-only bound for the day picker — a conservative per-month max (allows 29
// for February so a leap-year Feb 29 anchor is selectable at all). The real
// per-year clamping happens in computeNextOccurrence, not here.
const MAX_DAY_FOR_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface Props {
  interval: GroupRecurrence;
  anchor: RecurrenceAnchor;
  onChange: (anchor: RecurrenceAnchor) => void;
}

export default function RecurrenceAnchorPicker({ interval, anchor, onChange }: Props) {
  const { accentColor } = useTheme();

  if (interval === 'manual') return null;

  if (interval === 'weekly') {
    return (
      <View style={styles.section}>
        <Text style={styles.label}>On which day</Text>
        <View style={styles.chipRow}>
          {WEEKDAY_LABELS.map((label, i) => {
            const active = anchor.weekday === i;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                onPress={() => onChange({ ...anchor, weekday: i })}
              >
                <Text style={[styles.chipText, active && { color: accentColor }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }

  if (interval === 'monthly') {
    const days = Array.from({ length: 31 }, (_, i) => i + 1);
    return (
      <View style={styles.section}>
        <Text style={styles.label}>On which day of the month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {days.map(day => {
            const active = anchor.dayOfMonth === day;
            return (
              <TouchableOpacity
                key={day}
                style={[styles.dayChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
                onPress={() => onChange({ ...anchor, dayOfMonth: day })}
              >
                <Text style={[styles.chipText, active && { color: accentColor }]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {(anchor.dayOfMonth ?? 0) > 28 && (
          <Text style={styles.hint}>If a month is shorter, the last day of that month is used.</Text>
        )}
      </View>
    );
  }

  // yearly
  const month = anchor.month ?? 1;
  const maxDay = MAX_DAY_FOR_MONTH[month - 1];
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Which date each year</Text>
      <View style={styles.chipRow}>
        {MONTH_LABELS.map((label, i) => {
          const m = i + 1;
          const active = anchor.month === m;
          const dayStillValid = (anchor.day ?? 1) <= MAX_DAY_FOR_MONTH[i];
          return (
            <TouchableOpacity
              key={m}
              style={[styles.chip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
              onPress={() => onChange({
                ...anchor,
                month: m,
                day: dayStillValid ? anchor.day : MAX_DAY_FOR_MONTH[i],
              })}
            >
              <Text style={[styles.chipText, active && { color: accentColor }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.label, styles.dayGridSpacing]}>On which day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {days.map(day => {
          const active = anchor.day === day;
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayChip, active && { backgroundColor: `${accentColor}26`, borderColor: accentColor }]}
              onPress={() => onChange({ ...anchor, day })}
            >
              <Text style={[styles.chipText, active && { color: accentColor }]}>{day}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {maxDay === 29 && anchor.day === 29 && (
        <Text style={styles.hint}>In non-leap years, Feb 28 is used instead.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 4 },
  // Regular weight, not bold — this sits directly under the parent screen's
  // bold uppercase section eyebrow (e.g. "SCHEDULE"); giving it the same
  // visual weight as that header made two headings compete for attention.
  label: { fontSize: 13, fontWeight: '400', color: '#888888' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayGridSpacing: { marginTop: 4 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A', backgroundColor: '#1A1A1A',
  },
  dayChip: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  hint: { fontSize: 12, color: '#888888', marginTop: -2 },
});
