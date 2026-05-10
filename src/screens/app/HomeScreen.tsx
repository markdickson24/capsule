import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';

type CapsuleWithCountdown = Capsule & { daysLeft: number; hoursLeft: number };

function getTimeLeft(unlockAt: string) {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return { daysLeft: 0, hoursLeft: 0 };
  const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { daysLeft, hoursLeft };
}

function CountdownBadge({ daysLeft, hoursLeft, status }: { daysLeft: number; hoursLeft: number; status: string }) {
  if (status === 'unlocked') return <Text style={styles.unlockedBadge}>🔓 Unlocked</Text>;
  if (daysLeft > 0) return <Text style={styles.countdownText}>{daysLeft}d {hoursLeft}h left</Text>;
  return <Text style={styles.countdownText}>{hoursLeft}h left</Text>;
}

function CapsuleCard({ capsule, onPress }: { capsule: CapsuleWithCountdown; onPress: () => void }) {
  const isLocked = capsule.status !== 'unlocked';
  return (
    <TouchableOpacity style={[styles.card, !isLocked && styles.cardUnlocked]} onPress={onPress}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{isLocked ? '⏳' : '🔓'}</Text>
        <CountdownBadge daysLeft={capsule.daysLeft} hoursLeft={capsule.hoursLeft} status={capsule.status} />
      </View>
      <Text style={styles.cardTitle}>{capsule.title}</Text>
      {capsule.description ? <Text style={styles.cardDesc} numberOfLines={2}>{capsule.description}</Text> : null}
      <Text style={styles.cardDate}>
        {isLocked ? 'Unlocks' : 'Unlocked'} {new Date(capsule.unlock_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [capsules, setCapsules] = useState<CapsuleWithCountdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchCapsules() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('capsule_members')
      .select('capsule_id, capsules(*)')
      .eq('user_id', user.id);

    if (error || !data) return;

    const enriched: CapsuleWithCountdown[] = data
      .map((row: any) => row.capsules)
      .filter(Boolean)
      .map((c: Capsule) => ({ ...c, ...getTimeLeft(c.unlock_at) }));

    setCapsules(enriched);
  }

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchCapsules().finally(() => setLoading(false));
  }, []));

  async function onRefresh() {
    setRefreshing(true);
    await fetchCapsules();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#FF6B35" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Capsules</Text>
        <Text style={styles.count}>{capsules.length} total</Text>
      </View>

      {capsules.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⏳</Text>
          <Text style={styles.emptyText}>No capsules yet</Text>
          <Text style={styles.emptySubtext}>Tap + to create your first one</Text>
        </View>
      ) : (
        <FlatList
          data={capsules}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CapsuleCard
              capsule={item}
              onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: item.id })}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6B35" />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  count: { fontSize: 14, color: '#555555' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  emptySubtext: { fontSize: 15, color: '#888888' },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardUnlocked: { borderColor: '#FF6B3540' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardEmoji: { fontSize: 24 },
  countdownText: { fontSize: 13, fontWeight: '700', color: '#FF6B35' },
  unlockedBadge: { fontSize: 13, fontWeight: '700', color: '#30D158' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  cardDesc: { fontSize: 14, color: '#888888', lineHeight: 20 },
  cardDate: { fontSize: 12, color: '#555555', marginTop: 4 },
});
