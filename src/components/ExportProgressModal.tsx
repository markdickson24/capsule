import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import LoadingBrand from './LoadingBrand';
import { useTheme } from '../context/ThemeContext';

export default function ExportProgressModal({
  visible, done, total, onCancel,
}: { visible: boolean; done: number; total: number; onCancel?: () => void }) {
  const { accentColor } = useTheme();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <LoadingBrand size="small" color={accentColor} />
          <Text style={styles.title}>Preparing your download…</Text>
          {total > 0 ? (
            <>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${pct}%`, backgroundColor: accentColor }]} />
              </View>
              <Text style={styles.sub}>{done} / {total}</Text>
            </>
          ) : null}
          {onCancel ? (
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel export"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 28, alignItems: 'center', gap: 12, minWidth: 240 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  track: { width: '100%', height: 4, borderRadius: 2, backgroundColor: '#2A2A2A', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  sub: { color: '#888888', fontSize: 13 },
  cancelBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, marginTop: 4 },
  cancelText: { color: '#888888', fontSize: 15, fontWeight: '600' },
});
