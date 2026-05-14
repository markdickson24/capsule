import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Color math ───────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v));
}

export function hexToHsv(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const v = max, s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return [((h % 360) + 360) % 360, s, v];
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = {
  value: string;
  onChange: (hex: string) => void;
  originalValue?: string;
};

export default function ColorPicker({ value, onChange, originalValue }: Props) {
  const init = hexToHsv(value) ?? [21, 1, 1];
  const [hue, setHue] = useState(init[0]);
  const [sat, setSat] = useState(init[1]);
  const [val, setVal] = useState(init[2]);
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const [svSize, setSvSize] = useState({ w: 1, h: 1 });
  const [hueSize, setHueSize] = useState({ w: 1, h: 1 });

  const currentColor = hsvToHex(hue, sat, val);
  const hueColor = hsvToHex(hue, 1, 1);

  useEffect(() => {
    setHexInput(currentColor);
    onChange(currentColor);
  }, [hue, sat, val]);

  function updateSV(x: number, y: number) {
    setSat(Math.max(0, Math.min(1, x / svSize.w)));
    setVal(Math.max(0, Math.min(1, 1 - y / svSize.h)));
  }

  function updateHue(x: number) {
    setHue(Math.max(0, Math.min(359.99, (x / hueSize.w) * 360)));
  }

  function handleHexInput(text: string) {
    const upper = text.toUpperCase();
    setHexInput(upper);
    const hsv = hexToHsv(upper);
    if (hsv) { setHue(hsv[0]); setSat(hsv[1]); setVal(hsv[2]); }
  }

  const thumbLeft = sat * svSize.w;
  const thumbTop = (1 - val) * svSize.h;
  const hueThumbLeft = (hue / 360) * hueSize.w;

  return (
    <View style={styles.root}>
      <View style={styles.previewRow}>
        <View style={[styles.previewSwatch, { backgroundColor: currentColor }]} />
        <View style={styles.previewInfo}>
          <Text style={styles.previewLabel}>Current color</Text>
          <Text style={[styles.previewHex, { color: currentColor }]}>{currentColor}</Text>
        </View>
        {originalValue ? (
          <View style={[styles.originalSwatch, { backgroundColor: originalValue }]} />
        ) : null}
      </View>

      <View
        style={styles.svPanel}
        onLayout={e => setSvSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={e => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        onResponderMove={e => updateSV(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      >
        <LinearGradient
          colors={['#FFFFFF', hueColor]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          colors={['transparent', '#000000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View
          pointerEvents="none"
          style={[styles.svThumb, { left: thumbLeft - 11, top: thumbTop - 11, borderColor: currentColor }]}
        />
      </View>

      <View
        style={styles.hueSlider}
        onLayout={e => setHueSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={e => updateHue(e.nativeEvent.locationX)}
        onResponderMove={e => updateHue(e.nativeEvent.locationX)}
      >
        <LinearGradient
          colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[StyleSheet.absoluteFillObject, { borderRadius: 10 }]}
        />
        <View
          pointerEvents="none"
          style={[styles.hueThumb, { left: hueThumbLeft - 10 }, Platform.select({
            default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
            web: {},
          })]}
        />
      </View>

      <View style={styles.hexRow}>
        <Text style={styles.hexLabel}>HEX</Text>
        <TextInput
          style={styles.hexInput}
          value={hexInput}
          onChangeText={handleHexInput}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          placeholderTextColor="#555"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 20 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  previewSwatch: { width: 56, height: 56, borderRadius: 28 },
  previewInfo: { flex: 1 },
  previewLabel: { fontSize: 12, color: '#555555', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewHex: { fontSize: 20, fontWeight: '700', marginTop: 2 },
  originalSwatch: { width: 28, height: 28, borderRadius: 14, opacity: 0.5 },
  svPanel: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  svThumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  hueSlider: {
    width: '100%',
    height: 36,
    borderRadius: 10,
    overflow: 'hidden',
  },
  hueThumb: {
    position: 'absolute',
    top: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hexLabel: { fontSize: 12, fontWeight: '700', color: '#555555', letterSpacing: 1, width: 36 },
  hexInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    letterSpacing: 1,
  },
});
