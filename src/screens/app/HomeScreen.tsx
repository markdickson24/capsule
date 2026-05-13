import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, FlatList,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';

type CapsuleWithCountdown = Capsule;

function getTimeLeft(unlockAt: string) {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return { daysLeft: 0, hoursLeft: 0 };
  const daysLeft = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { daysLeft, hoursLeft };
}

function CountdownBadge({ unlockAt, status }: { unlockAt: string; status: string }) {
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(unlockAt));

  useEffect(() => {
    if (status === 'unlocked') return;
    const id = setInterval(() => setTimeLeft(getTimeLeft(unlockAt)), 60_000);
    return () => clearInterval(id);
  }, [unlockAt, status]);

  if (status === 'unlocked') return (
    <View style={styles.unlockedBadge}>
      <Ionicons name="lock-open-outline" size={13} color="#30D158" />
      <Text style={styles.unlockedBadgeText}> Unlocked</Text>
    </View>
  );
  const { daysLeft, hoursLeft } = timeLeft;
  if (daysLeft > 0) return <Text style={styles.countdownText}>{daysLeft}d {hoursLeft}h left</Text>;
  return <Text style={styles.countdownText}>{hoursLeft}h left</Text>;
}

function CapsuleCard({ capsule, onPress, onLongPress }: { capsule: CapsuleWithCountdown; onPress: () => void; onLongPress?: () => void }) {
  const isLocked = capsule.status !== 'unlocked';
  return (
    <TouchableOpacity style={[styles.card, !isLocked && styles.cardUnlocked]} onPress={onPress} onLongPress={onLongPress} delayLongPress={400}>
      <View style={styles.cardTop}>
        <Ionicons
          name={isLocked ? 'time-outline' : 'lock-open-outline'}
          size={24}
          color={isLocked ? '#888888' : '#30D158'}
        />
        <CountdownBadge unlockAt={capsule.unlock_at} status={capsule.status} />
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
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchCapsules() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data, error } = await supabase
      .from('capsule_members')
      .select('capsule_id, capsules(*)')
      .eq('user_id', user.id)
      .not('joined_at', 'is', null);

    if (error || !data) return;

    const enriched: CapsuleWithCountdown[] = data
      .map((row: any) => row.capsules)
      .filter(Boolean);

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
        {capsules.length > 0 && <Text style={styles.count}>{capsules.length} total</Text>}
      </View>

      {capsules.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyArt}>
            <View style={styles.emptyArtBack}><Ionicons name="camera-outline" size={52} color="#FFFFFF" /></View>
            <View style={styles.emptyArtMid}><Ionicons name="sparkles-outline" size={52} color="#FFFFFF" /></View>
            <View style={styles.emptyArtFront}><Ionicons name="time-outline" size={64} color="#FFFFFF" /></View>
          </View>
          <Text style={styles.emptyText}>Create your first capsule</Text>
          <Text style={styles.emptySubtext}>
            Lock photos and videos in time.{'\n'}Open them together when the moment arrives.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => navigation.navigate('Tabs', { screen: 'Create' })}
          >
            <Text style={styles.emptyBtnText}>Create a Capsule</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={capsules}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CapsuleCard
              capsule={item}
              onPress={() => navigation.navigate('CapsuleDetail', { capsuleId: item.id })}
              onLongPress={
                item.owner_id === userId && item.status !== 'unlocked'
                  ? () => navigation.navigate('EditCapsule', { capsuleId: item.id })
                  : undefined
              }
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
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, paddingHorizontal: 40 },
  emptyArt: { flexDirection: 'row', marginBottom: 8 },
  emptyArtBack: { transform: [{ rotate: '-12deg' }, { translateX: 18 }, { translateY: 8 }], opacity: 0.5 },
  emptyArtMid: { transform: [{ rotate: '6deg' }], opacity: 0.7, zIndex: 1 },
  emptyArtFront: { transform: [{ rotate: '-4deg' }, { translateX: -12 }], zIndex: 2 },
  emptyText: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  emptySubtext: { fontSize: 15, color: '#888888', textAlign: 'center', lineHeight: 22 },
  emptyBtn: { marginTop: 8, backgroundColor: '#FF6B35', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  emptyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
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
  countdownText: { fontSize: 13, fontWeight: '700', color: '#FF6B35' },
  unlockedBadge: { flexDirection: 'row', alignItems: 'center' },
  unlockedBadgeText: { fontSize: 13, fontWeight: '700', color: '#30D158' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  cardDesc: { fontSize: 14, color: '#888888', lineHeight: 20 },
  cardDate: { fontSize: 12, color: '#555555', marginTop: 4 },
});
