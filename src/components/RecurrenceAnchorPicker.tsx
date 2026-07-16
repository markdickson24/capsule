import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RecurrenceAnchor } from '../lib/recurrence';
import { GroupRecurrence } from '../lib/groups';
import { useTheme } from '../context/ThemeContext';
import { haptics } from '../lib/haptics';

// Same LayoutAnimation setup as DatePicker.tsx, whose collapsible
// pill + dark expanded card + calendar-with-mode-switch this component is
// directly modeled on — adapted for picking a recurring anchor (a repeating
// weekday/day-of-month/month+day rule) rather than one absolute date.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
const SPRING = { duration: 280, update: { type: 'easeInEaseOut' as const }, delete: { type: 'easeInEaseOut' as const } };

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LABELS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
// UI-only bound for the day grid — a conservative per-month max (allows 29
// for February so a leap-year Feb 29 anchor is selectable at all). The real
// per-year clamping happens in computeNextOccurrence, not here.
const MAX_DAY_FOR_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

interface Props {
  interval: GroupRecurrence;
  anchor: RecurrenceAnchor;
  onChange: (anchor: RecurrenceAnchor) => void;
}

// Shared with CreateGroupScreen/ManageGroupScreen's collapsed schedule
// summaries, so the summary line can never drift from this picker's own
// compact/preview text — both read from the same source.
export function describeAnchor(interval: GroupRecurrence, anchor: RecurrenceAnchor): { compact: string; sentence: string } {
  if (interval === 'weekly') {
    const weekday = anchor.weekday ?? 0;
    return { compact: WEEKDAY_LABELS_LONG[weekday], sentence: `Every week on ${WEEKDAY_LABELS_LONG[weekday]}` };
  }
  if (interval === 'monthly') {
    const day = anchor.dayOfMonth ?? 1;
    return { compact: `The ${ordinal(day)}`, sentence: `Every month on the ${ordinal(day)}` };
  }
  const month = anchor.month ?? 1;
  const day = anchor.day ?? 1;
  return {
    compact: `${MONTH_LABELS[month - 1]} ${day}`,
    sentence: `Every year on ${MONTH_LABELS_LONG[month - 1]} ${day}`,
  };
}

// 7-column day grid — direct-inspired by DatePicker.tsx's own day grid (same
// circle-on-select treatment), but with no weekday header or month binding:
// a recurrence day-of-month isn't a real date, it repeats every period, so
// there's no specific weekday to align columns to.
function DayGrid({ days, selected, onSelect, accentColor }: {
  days: number[]; selected: number | undefined; onSelect: (day: number) => void; accentColor: string;
}) {
  const rows: number[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <View style={s.grid}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.gridRow}>
          {row.map(day => {
            const active = selected === day;
            return (
              <TouchableOpacity
                key={day}
                style={s.dayCell}
                onPress={() => { haptics.light(); onSelect(day); }}
                activeOpacity={0.6}
              >
                <View style={[s.dayInner, active && { backgroundColor: accentColor }]}>
                  <Text style={[s.dayText, active && s.dayTextActive]}>{day}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {/* pad the last row so every row stays aligned to the 7-column grid */}
          {row.length < 7 && Array.from({ length: 7 - row.length }).map((_, i) => (
            <View key={`pad-${i}`} style={s.dayCell} />
          ))}
        </View>
      ))}
    </View>
  );
}

// 3-column month grid — direct-inspired by DatePicker.tsx's own month-picker
// mode (same flex-cell, filled-on-select treatment), reached by tapping the
// month name in the yearly picker's day view, exactly like DatePicker's
// tappable "June 2026 ▾" header.
function MonthGrid({ selected, onSelect, accentColor }: {
  selected: number; onSelect: (month: number) => void; accentColor: string;
}) {
  return (
    <View style={s.monthGrid}>
      {[0, 1, 2, 3].map(row => (
        <View key={row} style={s.monthGridRow}>
          {[0, 1, 2].map(col => {
            const m = row * 3 + col + 1;
            const active = selected === m;
            return (
              <TouchableOpacity
                key={col}
                style={[s.monthCell, active && { backgroundColor: accentColor }]}
                onPress={() => { haptics.selection(); onSelect(m); }}
                activeOpacity={0.6}
              >
                <Text style={[s.monthCellText, active && s.monthCellTextActive]}>{MONTH_LABELS[m - 1]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function RecurrenceAnchorPicker({ interval, anchor, onChange }: Props) {
  const { accentColor } = useTheme();
  // Expanded by default — unlike DatePicker's unlock-date field (one of many
  // fields in a long form, so collapsing it reduces clutter), this picker is
  // the primary reason you're in the Schedule section once a real interval
  // is chosen, so hiding it behind an extra tap would just add friction. The
  // same collapse mechanism still exists if you want to tuck it away.
  const [expanded, setExpanded] = useState(true);
  const [yearlyMode, setYearlyMode] = useState<'day' | 'month'>('day');
  const chevronRotation = useRef(new Animated.Value(1)).current;

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(SPRING);
    setExpanded(v => {
      const next = !v;
      Animated.spring(chevronRotation, {
        toValue: next ? 1 : 0,
        useNativeDriver: true,
        tension: 200,
        friction: 20,
      }).start();
      return next;
    });
  }, [chevronRotation]);

  if (interval === 'manual') return null;

  const chevronSpin = chevronRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  const { compact, sentence: preview } = describeAnchor(interval, anchor);

  function stepYearlyMonth(direction: 1 | -1) {
    haptics.selection();
    const current = anchor.month ?? 1;
    const next = ((current - 1 + direction + 12) % 12) + 1;
    const maxDay = MAX_DAY_FOR_MONTH[next - 1];
    onChange({ ...anchor, month: next, day: Math.min(anchor.day ?? 1, maxDay) });
  }

  return (
    <View style={s.container}>
      <TouchableOpacity
        style={[s.display, expanded && { borderColor: `${accentColor}60` }]}
        onPress={toggleExpand}
        activeOpacity={0.8}
      >
        <View style={s.displayLeft}>
          <View style={[s.displayIcon, { backgroundColor: `${accentColor}18` }]}>
            <Ionicons name="calendar" size={16} color={accentColor} />
          </View>
          <Text style={s.displayText}>{compact}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronSpin }] }}>
          <Ionicons name="chevron-down" size={18} color="#666" />
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={s.expandedBody}>
          {interval === 'weekly' && (
            <View style={s.weekdayRow}>
              {WEEKDAY_LABELS.map((label, i) => {
                const active = anchor.weekday === i;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[s.weekdayChip, active && { backgroundColor: accentColor }]}
                    onPress={() => { haptics.selection(); onChange({ ...anchor, weekday: i }); }}
                    activeOpacity={0.6}
                  >
                    <Text style={[s.weekdayChipText, active && s.weekdayChipTextActive]} numberOfLines={1}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {interval === 'monthly' && (
            <>
              <View style={s.quickRow}>
                {[{ label: '1st', day: 1 }, { label: '15th', day: 15 }, { label: 'Last day', day: 31 }].map(opt => {
                  const active = anchor.dayOfMonth === opt.day;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      style={[s.quickChip, active && { backgroundColor: `${accentColor}20`, borderColor: accentColor }]}
                      onPress={() => { haptics.light(); onChange({ ...anchor, dayOfMonth: opt.day }); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.quickChipText, active && { color: accentColor }]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <DayGrid
                days={Array.from({ length: 31 }, (_, i) => i + 1)}
                selected={anchor.dayOfMonth}
                onSelect={day => onChange({ ...anchor, dayOfMonth: day })}
                accentColor={accentColor}
              />
              {(anchor.dayOfMonth ?? 0) > 28 && (
                <Text style={s.hint}>If a month is shorter, the last day of that month is used.</Text>
              )}
            </>
          )}

          {interval === 'yearly' && (() => {
            const month = anchor.month ?? 1;
            const maxDay = MAX_DAY_FOR_MONTH[month - 1];
            const days = Array.from({ length: maxDay }, (_, i) => i + 1);
            return (
              <>
                {yearlyMode === 'day' ? (
                  <>
                    <View style={s.monthNavRow}>
                      <TouchableOpacity onPress={() => stepYearlyMonth(-1)} style={s.navBtn}>
                        <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => { haptics.light(); setYearlyMode('month'); }}
                        style={s.monthLabelBtn}
                        activeOpacity={0.7}
                      >
                        <Text style={s.monthLabel}>{MONTH_LABELS_LONG[month - 1]}</Text>
                        <Ionicons name="chevron-down" size={14} color="#666" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => stepYearlyMonth(1)} style={s.navBtn}>
                        <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                    <DayGrid
                      days={days}
                      selected={anchor.day}
                      onSelect={day => onChange({ ...anchor, day })}
                      accentColor={accentColor}
                    />
                  </>
                ) : (
                  <MonthGrid
                    selected={month}
                    onSelect={m => {
                      const newMaxDay = MAX_DAY_FOR_MONTH[m - 1];
                      onChange({ ...anchor, month: m, day: Math.min(anchor.day ?? 1, newMaxDay) });
                      setYearlyMode('day');
                    }}
                    accentColor={accentColor}
                  />
                )}
                {maxDay === 29 && anchor.day === 29 && (
                  <Text style={s.hint}>In non-leap years, Feb 28 is used instead.</Text>
                )}
              </>
            );
          })()}

          <View style={s.previewRow}>
            <View style={[s.previewDot, { backgroundColor: accentColor }]} />
            <Text style={s.previewText}>{preview}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 8 },

  display: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#141414', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  displayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  displayIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  displayText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  expandedBody: {
    backgroundColor: '#111111', borderRadius: 16, borderWidth: 1, borderColor: '#1E1E1E', overflow: 'hidden',
  },

  // All 7 days of the week, fixed set — same single-line-via-flex treatment
  // as the recurrence/reminder chip rows, so it reads like one complete week
  // at a glance rather than risking an odd day wrapping onto its own row.
  weekdayRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4,
  },
  weekdayChip: {
    flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2, borderRadius: 12,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#222',
  },
  weekdayChipText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  weekdayChipTextActive: { color: '#FFFFFF' },

  quickRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  quickChip: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#222',
  },
  quickChipText: { fontSize: 13, fontWeight: '600', color: '#888888' },

  monthNavRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4,
  },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  monthLabelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  grid: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8, gap: 2 },
  gridRow: { flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  dayInner: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
  },
  dayText: { fontSize: 13, fontWeight: '600', color: '#888888' },
  dayTextActive: { color: '#FFFFFF' },

  monthGrid: { gap: 6, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  monthGridRow: { flexDirection: 'row', gap: 6 },
  monthCell: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14,
    borderRadius: 12, backgroundColor: '#1A1A1A',
  },
  monthCellText: { fontSize: 14, fontWeight: '600', color: '#AAAAAA' },
  monthCellTextActive: { color: '#FFFFFF', fontWeight: '700' },

  hint: { fontSize: 12, color: '#888888', paddingHorizontal: 14, paddingBottom: 8 },

  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 14, marginBottom: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#1E1E1E',
  },
  previewDot: { width: 8, height: 8, borderRadius: 4 },
  previewText: { fontSize: 13, color: '#AAAAAA', fontWeight: '500' },
});
