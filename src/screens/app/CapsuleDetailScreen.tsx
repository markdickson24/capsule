import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { Capsule } from '../../types/database';
import { AppStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<AppStackParamList, 'CapsuleDetail'>;

type MemberRow = {
  role: string;
  joined_at: string | null;
  users: { display_name: string; avatar_url: string | null } | null;
};

const roleIcon: Record<string, string> = {
  owner: '👑',
  contributor: '✏️',
  viewer: '👁',
};

const roleLabel: Record<string, string> = {
  owner: 'Owner',
  contributor: 'Contributor',
  viewer: 'Viewer',
};

function getTimeLeft(unlockAt: string) {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { days, hours };
}

export default function CapsuleDetailScreen({ route, navigation }: Props) {
  const { capsuleId } = route.params;
  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const [capsuleRes, membersRes] = await Promise.all([
        supabase.from('capsules').select('*').eq('id', capsuleId).single(),
        supabase
          .from('capsule_members')
          .select('role, joined_at, users(display_name, avatar_url)')
          .eq('capsule_id', capsuleId),
      ]);

      if (capsuleRes.error) {
        setError('Failed to load capsule.');
      } else {
        setCapsule(capsuleRes.data);
      }

      if (membersRes.data) {
        setMembers(membersRes.data as MemberRow[]);
      }

      setLoading(false);
    }
    load();
  }, [capsuleId]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#FF6B35" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error || !capsule) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.errorText}>{error || 'Capsule not found.'}</Text>
      </SafeAreaView>
    );
  }

  const isLocked = capsule.status !== 'unlocked';
  const timeLeft = isLocked ? getTimeLeft(capsule.unlock_at) : null;
  const unlockDate = new Date(capsule.unlock_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const unlockTime = new Date(capsule.unlock_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>{isLocked ? '⏳' : '🔓'}</Text>
          <View style={[styles.statusBadge, !isLocked && styles.statusBadgeUnlocked]}>
            <Text style={[styles.statusText, !isLocked && styles.statusTextUnlocked]}>
              {capsule.status.toUpperCase()}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{capsule.title}</Text>
        {capsule.description ? (
          <Text style={styles.description}>{capsule.description}</Text>
        ) : null}

        <View style={styles.timeCard}>
          {isLocked && timeLeft ? (
            <>
              <Text style={styles.timeLabel}>Time remaining</Text>
              <Text style={styles.timeValue}>
                {timeLeft.days > 0 ? `${timeLeft.days}d ${timeLeft.hours}h` : `${timeLeft.hours}h`}
              </Text>
            </>
          ) : (
            <Text style={styles.timeLabel}>{isLocked ? 'Unlocking soon' : 'Unlocked'}</Text>
          )}
          <Text style={styles.timeDate}>{unlockDate} at {unlockTime}</Text>
        </View>

        <Text style={styles.sectionTitle}>Members</Text>
        <View style={styles.membersList}>
          {members.map((m, i) => (
            <View key={i} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(m.users?.display_name ?? '?')[0].toUpperCase()}
                </Text>
              </View>
              <Text style={styles.memberName}>{m.users?.display_name ?? 'Member'}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{roleIcon[m.role]} {roleLabel[m.role]}</Text>
              </View>
            </View>
          ))}
        </View>

        {isLocked ? (
          <View style={styles.lockedBox}>
            <Text style={styles.lockedIcon}>🔒</Text>
            <Text style={styles.lockedText}>Photos hidden until unlock</Text>
          </View>
        ) : (
          <View style={styles.lockedBox}>
            <Text style={styles.lockedIcon}>📸</Text>
            <Text style={styles.lockedText}>Photos coming soon</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  backBtn: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  backText: { color: '#FF6B35', fontSize: 16, fontWeight: '600' },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  heroEmoji: { fontSize: 40 },
  statusBadge: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeUnlocked: { backgroundColor: '#30D15820' },
  statusText: { fontSize: 12, fontWeight: '700', color: '#888888', letterSpacing: 1 },
  statusTextUnlocked: { color: '#30D158' },
  title: { fontSize: 30, fontWeight: '800', color: '#FFFFFF' },
  description: { fontSize: 16, color: '#888888', lineHeight: 24 },
  timeCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 4,
  },
  timeLabel: { fontSize: 13, color: '#555555', textTransform: 'uppercase', letterSpacing: 0.5 },
  timeValue: { fontSize: 32, fontWeight: '800', color: '#FF6B35' },
  timeDate: { fontSize: 14, color: '#888888' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginTop: 8 },
  membersList: { gap: 8 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF6B3530',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#FF6B35' },
  memberName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  roleBadge: { backgroundColor: '#2A2A2A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { fontSize: 12, color: '#888888' },
  lockedBox: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginTop: 8,
  },
  lockedIcon: { fontSize: 32 },
  lockedText: { fontSize: 15, color: '#555555' },
  errorText: { color: '#FF3B30', textAlign: 'center', marginTop: 40, fontSize: 15 },
});
