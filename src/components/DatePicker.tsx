import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Platform, Switch, LayoutAnimation, UIManager,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import InfoTooltip from './InfoTooltip';

function haptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(style);
}

function hapticSelection() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync();
}

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SPRING = { duration: 280, update: { type: 'easeInEaseOut' as const }, delete: { type: 'easeInEaseOut' as const } };

function defaultDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(12, 0, 0, 0);
  return d;
}

type QuickOption = { label: string; icon: keyof typeof Ionicons.glyphMap; getDate: () => Date };

const QUICK_OPTIONS: QuickOption[] = [
  { label: 'Tomorrow', icon: 'sunny-outline', getDate: () => addDays(1) },
  { label: '1 week', icon: 'calendar-outline', getDate: () => addDays(7) },
  { label: '1 month', icon: 'calendar-number-outline', getDate: () => addDays(30) },
  { label: '3 months', icon: 'time-outline', getDate: () => addDays(90) },
];

function formatPreview(date: Date) {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { dayName, monthDay, year: String(year), time };
}

function formatCompact(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function getRelativeLabel(date: Date): string | null {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs < 0) return null;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return 'In 1 week';
  if (days < 30) return `In ${weeks} weeks`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'In 1 month';
  if (months < 12) return `In ${months} months`;
  return `In ${Math.floor(months / 12)} year${Math.floor(months / 12) > 1 ? 's' : ''}`;
}

const QuickChip = memo(function QuickChip({
  option, isActive, accentColor, onPress,
}: {
  option: QuickOption; isActive: boolean; accentColor: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        s.chip,
        isActive && { backgroundColor: `${accentColor}20`, borderColor: accentColor },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons
        name={option.icon}
        size={13}
        color={isActive ? accentColor : '#666'}
      />
      <Text style={[s.chipText, isActive && { color: accentColor }]}>
        {option.label}
      </Text>
    </TouchableOpacity>
  );
});

const LivePreview = memo(function LivePreview({
  date, accentColor, contextLabel,
}: {
  date: Date; accentColor: string; contextLabel?: string;
}) {
  const { dayName, monthDay, year, time } = formatPreview(date);
  const relative = getRelativeLabel(date);

  return (
    <View style={s.preview}>
      <View style={s.previewLeft}>
        <View style={[s.previewDot, { backgroundColor: accentColor }]} />
      </View>
      <View style={s.previewContent}>
        <Text style={s.previewMain}>
          {dayName}, {monthDay}
        </Text>
        <Text style={s.previewSub}>
          {time} · {year}
          {relative ? ` · ${relative}` : ''}
        </Text>
        {contextLabel && (
          <Text style={[s.previewContext, { color: `${accentColor}CC` }]}>{contextLabel}</Text>
        )}
      </View>
    </View>
  );
});

// --- Calendar ---

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function buildWeeks(year: number, month: number): (number | null)[][] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const Calendar = memo(function Calendar({
  selected, onSelect, minimumDate, accentColor,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  minimumDate?: Date;
  accentColor: string;
}) {
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [mode, setMode] = useState<'days' | 'months'>('days');

  const selMonth = selected.getMonth();
  const selYear = selected.getFullYear();
  useEffect(() => {
    setViewMonth(selMonth);
    setViewYear(selYear);
  }, [selMonth, selYear]);

  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();

  const minDate = minimumDate
    ? new Date(minimumDate.getFullYear(), minimumDate.getMonth(), minimumDate.getDate())
    : null;

  const weeks = buildWeeks(viewYear, viewMonth);
  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long' });

  const canPrevMonth = !minDate || new Date(viewYear, viewMonth, 0) >= minDate;
  const canPrevYear = !minDate || viewYear > minDate.getFullYear();

  function prevMonth() {
    hapticSelection();
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    hapticSelection();
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  function pickMonth(m: number) {
    haptic();
    setViewMonth(m);
    setMode('days');
  }

  if (mode === 'months') {
    return (
      <View style={cs.calendar}>
        <View style={cs.monthRow}>
          <TouchableOpacity onPress={() => { hapticSelection(); setViewYear(y => y - 1); }} disabled={!canPrevYear} style={cs.navBtn}>
            <Ionicons name="chevron-back" size={18} color={canPrevYear ? '#FFFFFF' : '#333'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { haptic(); setMode('days'); }} activeOpacity={0.7}>
            <Text style={cs.monthLabel}>{viewYear}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { hapticSelection(); setViewYear(y => y + 1); }} style={cs.navBtn}>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={cs.monthGrid}>
          {[0, 1, 2, 3].map(row => (
            <View key={row} style={cs.monthGridRow}>
              {[0, 1, 2].map(col => {
                const m = row * 3 + col;
                const isSel = m === selMonth && viewYear === selYear;
                const isCurrent = m === todayMonth && viewYear === todayYear;
                const isPast = minDate && new Date(viewYear, m + 1, 0) < minDate;
                return (
                  <TouchableOpacity
                    key={col}
                    style={[
                      cs.monthCell,
                      isSel && { backgroundColor: accentColor },
                      isCurrent && !isSel && { borderWidth: 1, borderColor: `${accentColor}60` },
                    ]}
                    onPress={() => pickMonth(m)}
                    disabled={!!isPast}
                    activeOpacity={0.6}
                  >
                    <Text style={[
                      cs.monthCellText,
                      isSel && { color: '#FFFFFF', fontWeight: '700' },
                      isCurrent && !isSel && { color: accentColor },
                      isPast && cs.dayTextPast,
                    ]}>
                      {MONTH_NAMES_SHORT[m]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={cs.calendar}>
      <View style={cs.monthRow}>
        <TouchableOpacity onPress={prevMonth} disabled={!canPrevMonth} style={cs.navBtn}>
          <Ionicons name="chevron-back" size={18} color={canPrevMonth ? '#FFFFFF' : '#333'} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { haptic(); setMode('months'); }} activeOpacity={0.7} style={cs.monthLabelBtn}>
          <Text style={cs.monthLabel}>{monthLabel} {viewYear}</Text>
          <Ionicons name="chevron-down" size={14} color="#666" />
        </TouchableOpacity>
        <TouchableOpacity onPress={nextMonth} style={cs.navBtn}>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={cs.weekdayRow}>
        {WEEKDAYS.map((d, i) => (
          <Text key={i} style={cs.weekdayText}>{d}</Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={cs.weekRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={cs.dayCell} />;
            const isSel = day === selected.getDate() && viewMonth === selMonth && viewYear === selYear;
            const isToday = day === todayDay && viewMonth === todayMonth && viewYear === todayYear;
            const isPast = minDate ? new Date(viewYear, viewMonth, day) < minDate : false;
            return (
              <TouchableOpacity
                key={di}
                style={cs.dayCell}
                onPress={() => { haptic(); onSelect(new Date(viewYear, viewMonth, day)); }}
                disabled={isPast}
                activeOpacity={0.6}
              >
                <View style={[
                  cs.dayInner,
                  isSel && { backgroundColor: accentColor },
                  isToday && !isSel && { borderWidth: 1, borderColor: `${accentColor}60` },
                ]}>
                  <Text style={[
                    cs.dayText,
                    isSel && cs.dayTextSel,
                    isToday && !isSel && { color: accentColor },
                    isPast && cs.dayTextPast,
                  ]}>
                    {day}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const cs = StyleSheet.create({
  calendar: { paddingHorizontal: 8, paddingBottom: 4 },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingVertical: 8,
  },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  monthLabelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  weekdayRow: { flexDirection: 'row', paddingBottom: 4 },
  weekdayText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#555' },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  dayInner: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 15, color: '#FFFFFF' },
  dayTextSel: { fontWeight: '700' },
  dayTextPast: { color: '#333' },
  monthGrid: { gap: 6, paddingHorizontal: 4, paddingBottom: 8 },
  monthGridRow: { flexDirection: 'row', gap: 6 },
  monthCell: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#1A1A1A',
  },
  monthCellText: { fontSize: 14, fontWeight: '600', color: '#AAAAAA' },
});

// --- DatePickerField ---

export default function DatePickerField({ label, optional, value, onChange, contextLabel, tooltip }: {
  label: string;
  optional?: boolean;
  value: Date | null;
  onChange: (date: Date | null) => void;
  contextLabel?: string;
  tooltip?: { title: string; body: string };
}) {
  const { accentColor } = useTheme();
  const fallback = defaultDate();
  const isEnabled = !optional || value !== null;
  const selected = value ?? fallback;

  const [expanded, setExpanded] = useState(false);
  const [activeQuick, setActiveQuick] = useState<string | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const chevronRotation = useRef(new Animated.Value(0)).current;

  const toggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(SPRING);
    setExpanded(v => !v);
    Animated.spring(chevronRotation, {
      toValue: expanded ? 0 : 1,
      useNativeDriver: true,
      tension: 200,
      friction: 20,
    }).start();
  }, [expanded, chevronRotation]);

  const handleQuickSelect = useCallback((option: QuickOption) => {
    haptic();
    const d = option.getDate();
    const merged = new Date(d);
    merged.setHours(selected.getHours(), selected.getMinutes());
    setActiveQuick(option.label);
    onChange(merged);
  }, [selected, onChange]);

  const handleDateChange = useCallback((date: Date) => {
    const merged = new Date(selected);
    merged.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    setActiveQuick(null);
    onChange(merged);
  }, [selected, onChange]);

  const handleTimeChange = useCallback((_: any, date?: Date) => {
    if (!date) return;
    const merged = new Date(selected);
    merged.setHours(date.getHours(), date.getMinutes());
    setActiveQuick(null);
    onChange(merged);
  }, [selected, onChange]);

  const chevronSpin = chevronRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  useEffect(() => {
    if (!isEnabled) {
      setExpanded(false);
      chevronRotation.setValue(0);
    }
  }, [isEnabled, chevronRotation]);

  const toggleTime = useCallback(() => {
    LayoutAnimation.configureNext(SPRING);
    setShowTimePicker(v => !v);
  }, []);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.labelRow}>
          <Text style={s.label}>{label}</Text>
          {tooltip && <InfoTooltip title={tooltip.title} body={tooltip.body} />}
        </View>
        {optional && (
          <Switch
            value={isEnabled}
            onValueChange={(on) => {
              LayoutAnimation.configureNext(SPRING);
              onChange(on ? fallback : null);
              if (!on) setExpanded(false);
            }}
            trackColor={{ false: '#2A2A2A', true: accentColor }}
            thumbColor="#FFFFFF"
          />
        )}
      </View>

      {isEnabled && (
        <>
          {/* Collapsed display — tap to expand */}
          <TouchableOpacity
            style={[s.display, expanded && { borderColor: `${accentColor}60` }]}
            onPress={toggleExpand}
            activeOpacity={0.8}
          >
            <View style={s.displayLeft}>
              <View style={[s.displayIcon, { backgroundColor: `${accentColor}18` }]}>
                <Ionicons name="calendar" size={16} color={accentColor} />
              </View>
              <Text style={s.displayText}>{formatCompact(selected)}</Text>
            </View>
            <Animated.View style={{ transform: [{ rotate: chevronSpin }] }}>
              <Ionicons name="chevron-down" size={18} color="#666" />
            </Animated.View>
          </TouchableOpacity>

          {expanded && (
            <View style={s.expandedBody}>
              {/* Quick options — 2x2 grid */}
              <View style={s.quickGrid}>
                <View style={s.quickGridRow}>
                  {QUICK_OPTIONS.slice(0, 2).map(opt => (
                    <QuickChip
                      key={opt.label}
                      option={opt}
                      isActive={activeQuick === opt.label}
                      accentColor={accentColor}
                      onPress={() => handleQuickSelect(opt)}
                    />
                  ))}
                </View>
                <View style={s.quickGridRow}>
                  {QUICK_OPTIONS.slice(2, 4).map(opt => (
                    <QuickChip
                      key={opt.label}
                      option={opt}
                      isActive={activeQuick === opt.label}
                      accentColor={accentColor}
                      onPress={() => handleQuickSelect(opt)}
                    />
                  ))}
                </View>
              </View>

              {/* Calendar */}
              <Calendar
                selected={selected}
                onSelect={handleDateChange}
                minimumDate={new Date()}
                accentColor={accentColor}
              />

              {/* Time row */}
              <TouchableOpacity
                style={s.timeRow}
                onPress={toggleTime}
                activeOpacity={0.7}
              >
                <View style={s.timeRowLeft}>
                  <View style={[s.timeIcon, { backgroundColor: `${accentColor}18` }]}>
                    <Ionicons name="time-outline" size={14} color={accentColor} />
                  </View>
                  <Text style={s.timeRowText}>
                    {selected.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </View>
                <Ionicons
                  name={showTimePicker ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color="#666"
                />
              </TouchableOpacity>

              {showTimePicker && (
                <DateTimePicker
                  value={selected}
                  mode="time"
                  display={Platform.OS === 'web' ? 'default' : 'spinner'}
                  onChange={handleTimeChange}
                  themeVariant="dark"
                  style={s.timePicker}
                />
              )}

              {/* Live preview */}
              <LivePreview
                date={selected}
                accentColor={accentColor}
                contextLabel={contextLabel}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 8 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#AAAAAA',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  display: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  displayLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  displayIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  expandedBody: {
    backgroundColor: '#111111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    overflow: 'hidden',
  },

  quickGrid: {
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 6,
  },
  quickGridRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#222',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#666' },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },
  timeRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRowText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  timePicker: { marginTop: -4 },

  preview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 14,
    marginTop: 2,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
  },
  previewLeft: { paddingTop: 4 },
  previewDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  previewContent: { flex: 1, gap: 2 },
  previewMain: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  previewSub: { fontSize: 13, color: '#888' },
  previewContext: { fontSize: 12, marginTop: 2 },
});
