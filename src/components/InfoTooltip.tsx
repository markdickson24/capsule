import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  TouchableWithoutFeedback, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Props = {
  title: string;
  body: string;
  size?: number;
  color?: string;
};

export default function InfoTooltip({ title, body, size = 17, color = '#555555' }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        hitSlop={10}
        activeOpacity={0.6}
        style={styles.trigger}
      >
        <Ionicons name="information-circle-outline" size={size} color={color} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <SafeAreaProvider>
          <TouchableWithoutFeedback onPress={() => setVisible(false)}>
            <View style={styles.backdrop}>
              <TouchableWithoutFeedback>
                <View style={styles.card}>
                  <Text style={styles.title}>{title}</Text>
                  <Text style={styles.body}>{body}</Text>
                  <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={() => setVisible(false)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dismissText}>Got it</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 24,
    gap: 12,
    width: '100%',
    maxWidth: 360,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  body: {
    fontSize: 14,
    color: '#AAAAAA',
    lineHeight: 21,
  },
  dismissBtn: {
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  dismissText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});
