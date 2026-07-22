import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { limitSheet, LimitAction, LimitSheetConfig } from '../lib/limitSheet';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface LimitSheetProps {
  config: LimitSheetConfig | null;
  onDismiss: () => void;
}

/**
 * Presentational smooth "you hit a limit" bottom sheet. Mounted once by
 * <LimitSheetHost> near the app root — see src/lib/limitSheet.ts for the
 * imperative show()/hide() API non-component code uses to trigger it.
 */
export function LimitSheet({ config, onDismiss }: LimitSheetProps) {
  const { accentColor } = useTheme();
  // The Modal itself has to outlive `config` going null for a moment so the
  // slide-down close animation is visible instead of the sheet vanishing
  // instantly (Modal has no exit-transition hook of its own for `visible`).
  const [rendered, setRendered] = useState<LimitSheetConfig | null>(config);
  const [modalVisible, setModalVisible] = useState(!!config);
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    if (config) {
      setRendered(config);
      setModalVisible(true);
      translateY.setValue(SCREEN_HEIGHT);
      Animated.spring(translateY, {
        toValue: 0,
        friction: 9,
        tension: 70,
        useNativeDriver: true,
      }).start();
    } else if (modalVisible) {
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setModalVisible(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const backdropOpacity = translateY.interpolate({
    inputRange: [0, SCREEN_HEIGHT],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  function fire(action: LimitAction) {
    action.onPress();
    onDismiss();
  }

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onDismiss}>
      {/* A Modal renders in its own native view hierarchy, unreachable by the
          root SafeAreaProvider — see CLAUDE.md "iOS / Web Layout Gotchas". */}
      <SafeAreaProvider>
        <View style={styles.wrap}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
            <Pressable style={styles.backdrop} onPress={onDismiss} />
          </Animated.View>
          <Animated.View style={[styles.cardWrap, { transform: [{ translateY }] }]}>
            <SafeAreaView edges={['bottom']} style={styles.safeArea}>
              <View style={styles.card}>
                <View style={styles.handle} />
                {rendered?.icon ? (
                  <View style={styles.iconWrap}>
                    <Ionicons name={rendered.icon as any} size={30} color={accentColor} />
                  </View>
                ) : null}
                <Text style={styles.title}>{rendered?.title}</Text>
                <Text style={styles.message}>{rendered?.message}</Text>
                <View style={styles.actions}>
                  {rendered?.actions.map((action, i) => (
                    <Pressable
                      key={`${action.label}-${i}`}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        action.style === 'primary' && { backgroundColor: accentColor },
                        action.style === 'secondary' && styles.actionBtnSecondary,
                        (!action.style || action.style === 'destructive') && styles.actionBtnGhost,
                        pressed && styles.actionBtnPressed,
                      ]}
                      onPress={() => fire(action)}
                    >
                      <Text
                        style={[
                          styles.actionText,
                          action.style === 'primary' && styles.actionTextPrimary,
                          action.style === 'destructive' && styles.actionTextDestructive,
                        ]}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Mounted once near the app root, adjacent to <ToastHost />. */
export function LimitSheetHost() {
  const [config, setConfig] = useState<LimitSheetConfig | null>(limitSheet.get());

  useEffect(() => limitSheet.subscribe(() => setConfig(limitSheet.get())), []);

  return <LimitSheet config={config} onDismiss={limitSheet.hide} />;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  cardWrap: {
    backgroundColor: '#0A0A0A',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  safeArea: {
    backgroundColor: '#0A0A0A',
  },
  card: {
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A2A2A',
    marginBottom: 12,
  },
  iconWrap: {
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  actionBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionBtnSecondary: {
    backgroundColor: '#1A1A1A',
  },
  actionBtnGhost: {
    backgroundColor: 'transparent',
  },
  actionBtnPressed: {
    opacity: 0.75,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  actionTextPrimary: {
    color: '#FFFFFF',
  },
  actionTextDestructive: {
    color: '#FF3B30',
  },
});
