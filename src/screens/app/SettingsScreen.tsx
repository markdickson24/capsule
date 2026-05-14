import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../../context/ThemeContext';
import { AppStackParamList } from '../../types/navigation';
import ColorPicker from '../../components/ColorPicker';

type Props = NativeStackScreenProps<AppStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  const { accentColor, setAccentColor } = useTheme();
  const [pending, setPending] = useState(accentColor);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await setAccentColor(pending);
    setSaving(false);
    navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={[styles.backText, { color: accentColor }]}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} scrollEnabled={false}>
        <Text style={styles.title}>Appearance</Text>
        <Text style={styles.subtitle}>Choose your accent color</Text>

        <ColorPicker value={accentColor} onChange={setPending} originalValue={accentColor} />

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: pending }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveBtnText}>Save Color</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48, gap: 20 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 15, color: '#888888', marginTop: -12 },
  saveBtn: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
