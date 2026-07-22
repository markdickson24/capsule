import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTour } from '../context/TourContext';
import { useTheme } from '../context/ThemeContext';

const DIM = 'rgba(0,0,0,0.72)';
const TOOLTIP_W = 300;

export default function TourOverlay() {
  const { active, steps, stepIndex, currentRect, next, back, skip } = useTour();
  const { accentColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = Dimensions.get('window');

  if (!active) return null;
  const step = steps[stepIndex];
  if (!step) return null;

  const isLast = stepIndex === steps.length - 1;
  const rect = currentRect;

  // Tooltip placement: below the target if it's in the top ~60% of the screen,
  // else above. No target (finish card) => centered.
  let tooltipTop: number;
  if (!rect) {
    tooltipTop = SH / 2 - 90;
  } else if (rect.y + rect.height < SH * 0.6) {
    tooltipTop = rect.y + rect.height + 14;
  } else {
    tooltipTop = rect.y - 14 - 170; // approx card height; clamped below
  }
  tooltipTop = Math.max(insets.top + 12, Math.min(tooltipTop, SH - insets.bottom - 190));
  const tooltipLeft = Math.max(12, Math.min((SW - TOOLTIP_W) / 2, SW - TOOLTIP_W - 12));

  const swallow = (e: any) => { e.stopPropagation?.(); };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
      {/* Dim panels forming a hole around `rect` (or full-screen dim when null). */}
      {rect ? (
        <>
          <Pressable style={[styles.panel, { left: 0, top: 0, width: SW, height: Math.max(0, rect.y) }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: 0, top: rect.y + rect.height, width: SW, height: Math.max(0, SH - (rect.y + rect.height)) }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.height }]} onPress={swallow} />
          <Pressable style={[styles.panel, { left: rect.x + rect.width, top: rect.y, width: Math.max(0, SW - (rect.x + rect.width)), height: rect.height }]} onPress={swallow} />
          {/* Transparent catcher over the hole so the real element can't be tapped mid-tour. */}
          <Pressable style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: 12, borderWidth: 2, borderColor: accentColor }} onPress={swallow} />
        </>
      ) : (
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: DIM }]} onPress={swallow} />
      )}

      {/* Tooltip card */}
      <View style={[styles.card, { top: tooltipTop, left: tooltipLeft, width: TOOLTIP_W }]}>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>{step.title}</Text>
        <Text style={styles.body} maxFontSizeMultiplier={1.4}>{step.body}</Text>

        <View style={styles.dots}>
          {steps.map((s, i) => (
            <View key={s.id} style={[styles.dot, { backgroundColor: i === stepIndex ? accentColor : '#3A3A3A' }]} />
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={skip} accessibilityRole="button" accessibilityLabel="Skip tour" hitSlop={8}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
          <View style={styles.rightActions}>
            {stepIndex > 0 && (
              <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Previous step" hitSlop={8} style={styles.backBtn}>
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            )}
            <Pressable onPress={isLast ? skip : next} accessibilityRole="button" accessibilityLabel={isLast ? 'Finish tour' : 'Next step'} style={[styles.nextBtn, { backgroundColor: accentColor }]}>
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', backgroundColor: DIM },
  card: {
    position: 'absolute', backgroundColor: '#1A1A1A', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#2A2A2A',
    ...Platform.select({ default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }, web: {} }),
  },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginBottom: 6 },
  body: { color: '#888888', fontSize: 14, lineHeight: 20 },
  dots: { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  skip: { color: '#888888', fontSize: 14, fontWeight: '500' },
  backBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  backText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  nextBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10 },
  nextText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
