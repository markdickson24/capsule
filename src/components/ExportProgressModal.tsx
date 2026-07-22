import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import LoadingBrand from './LoadingBrand';
import { useTheme } from '../context/ThemeContext';

export default function ExportProgressModal({
  visible, done, total,
}: { visible: boolean; done: number; total: number }) {
  const { accentColor } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <LoadingBrand size="small" color={accentColor} />
          <Text style={styles.title}>Preparing your download…</Text>
          <Text style={styles.sub}>{total > 0 ? `${done} / ${total}` : ''}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 28, alignItems: 'center', gap: 12, minWidth: 220 },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  sub: { color: '#888888', fontSize: 13 },
});
