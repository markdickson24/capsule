import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { useTheme } from '../context/ThemeContext';
import { SuperlativeStatus, SuperlativeTargetType } from '../types/database';
import SuggestCategoryModal from './SuggestCategoryModal';

type Props = {
  capsuleId: string;
  joinedMemberCount: number;
};

type CategoryRow = {
  id: string;
  label: string;
  target_type: SuperlativeTargetType;
  status: SuperlativeStatus;
  created_at: string;
};

type CategoryUI = CategoryRow & {
  upvote_count: number;
  i_upvoted: boolean;
};

export default function AwardsSection({ capsuleId, joinedMemberCount }: Props) {
  const { accentColor } = useTheme();
  const session = sessionStore.get();
  const userId = session?.user.id;

  const [categories, setCategories] = useState<CategoryUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const threshold = Math.max(1, Math.ceil(joinedMemberCount / 2));

  const fetchCategories = useCallback(async () => {
    const { data: cats, error: catErr } = await supabase
      .from('superlative_categories')
      .select('id, label, target_type, status, created_at')
      .eq('capsule_id', capsuleId)
      .neq('status', 'archived')
      .order('created_at', { ascending: false });

    if (catErr) {
      setLoading(false);
      return;
    }

    const rows = (cats ?? []) as CategoryRow[];
    const catIds = rows.map(c => c.id);

    let upvotes: { category_id: string; user_id: string }[] = [];
    if (catIds.length > 0) {
      const { data } = await supabase
        .from('superlative_upvotes')
        .select('category_id, user_id')
        .in('category_id', catIds);
      upvotes = (data ?? []) as { category_id: string; user_id: string }[];
    }

    const byId = new Map<string, { count: number; mine: boolean }>();
    for (const u of upvotes) {
      const cur = byId.get(u.category_id) ?? { count: 0, mine: false };
      cur.count += 1;
      if (u.user_id === userId) cur.mine = true;
      byId.set(u.category_id, cur);
    }

    setCategories(rows.map(r => ({
      ...r,
      upvote_count: byId.get(r.id)?.count ?? 0,
      i_upvoted: byId.get(r.id)?.mine ?? false,
    })));
    setLoading(false);
  }, [capsuleId, userId]);

  useEffect(() => {
    fetchCategories();
    const channel = supabase
      .channel(`awards-${capsuleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'superlative_categories', filter: `capsule_id=eq.${capsuleId}` },
        () => fetchCategories(),
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [capsuleId, fetchCategories]);

  async function toggleUpvote(c: CategoryUI) {
    if (!userId || busyIds.has(c.id)) return;
    setBusyIds(prev => new Set(prev).add(c.id));

    const wasUpvoted = c.i_upvoted;
    const optimistic = categories.map(x =>
      x.id === c.id
        ? { ...x, upvote_count: x.upvote_count + (wasUpvoted ? -1 : 1), i_upvoted: !wasUpvoted }
        : x,
    );
    setCategories(optimistic);

    let failed = false;
    if (wasUpvoted) {
      const { error } = await supabase
        .from('superlative_upvotes')
        .delete()
        .eq('category_id', c.id)
        .eq('user_id', userId);
      failed = !!error;
    } else {
      const { error } = await supabase
        .from('superlative_upvotes')
        .insert({ category_id: c.id, user_id: userId });
      failed = !!error;
    }

    setBusyIds(prev => {
      const next = new Set(prev);
      next.delete(c.id);
      return next;
    });

    if (failed) {
      // Revert + refetch authoritative state
      await fetchCategories();
    } else if (!wasUpvoted) {
      // The promote trigger may have flipped status to 'live' — refetch.
      await fetchCategories();
    }
  }

  const pending = useMemo(() => categories.filter(c => c.status === 'pending'), [categories]);
  const live = useMemo(() => categories.filter(c => c.status === 'live'), [categories]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Awards</Text>
        <TouchableOpacity
          style={[styles.suggestBtn, { backgroundColor: `${accentColor}20` }]}
          onPress={() => setShowSuggest(true)}
        >
          <Ionicons name="add" size={16} color={accentColor} />
          <Text style={[styles.suggestBtnText, { color: accentColor }]}>Suggest</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={accentColor} size="small" />
        </View>
      ) : categories.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="trophy-outline" size={28} color="#555" />
          <Text style={styles.emptyText}>No award categories yet.</Text>
          <Text style={styles.emptySubtext}>
            Suggest one — once {threshold} {threshold === 1 ? 'member upvotes' : 'members upvote'}, voting opens.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {live.length > 0 && (
            <>
              <Text style={styles.groupLabel}>Voting open</Text>
              {live.map(c => (
                <LiveCard key={c.id} category={c} />
              ))}
            </>
          )}
          {pending.length > 0 && (
            <>
              <Text style={[styles.groupLabel, live.length > 0 && { marginTop: 16 }]}>Suggestions</Text>
              {pending.map(c => (
                <PendingCard
                  key={c.id}
                  category={c}
                  threshold={threshold}
                  busy={busyIds.has(c.id)}
                  onToggleUpvote={() => toggleUpvote(c)}
                />
              ))}
            </>
          )}
        </View>
      )}

      <SuggestCategoryModal
        visible={showSuggest}
        capsuleId={capsuleId}
        onClose={() => setShowSuggest(false)}
        onSuggested={fetchCategories}
      />
    </View>
  );
}

function targetIcon(t: SuperlativeTargetType) {
  return t === 'person' ? 'person-outline' : 'images-outline';
}

function targetLabel(t: SuperlativeTargetType) {
  return t === 'person' ? 'Person' : 'Photo/Video';
}

function PendingCard({
  category, threshold, busy, onToggleUpvote,
}: {
  category: CategoryUI;
  threshold: number;
  busy: boolean;
  onToggleUpvote: () => void;
}) {
  const { accentColor } = useTheme();
  const pct = Math.min(1, category.upvote_count / threshold);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardMain}>
          <Text style={styles.cardLabel}>{category.label}</Text>
          <View style={styles.metaRow}>
            <Ionicons name={targetIcon(category.target_type)} size={12} color="#888" />
            <Text style={styles.metaText}>{targetLabel(category.target_type)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>
              {category.upvote_count}/{threshold} upvotes
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={[
            styles.upvoteBtn,
            category.i_upvoted && [styles.upvoteBtnActive, { backgroundColor: accentColor, borderColor: accentColor }],
          ]}
          onPress={onToggleUpvote}
          disabled={busy}
        >
          <Ionicons
            name={category.i_upvoted ? 'arrow-up' : 'arrow-up-outline'}
            size={16}
            color={category.i_upvoted ? '#FFFFFF' : '#888'}
          />
          <Text style={[styles.upvoteCount, category.i_upvoted && { color: '#FFFFFF' }]}>
            {category.upvote_count}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: accentColor }]} />
      </View>
    </View>
  );
}

function LiveCard({ category }: { category: CategoryUI }) {
  const { accentColor } = useTheme();
  return (
    <View style={[styles.card, styles.cardLive, { borderColor: `${accentColor}40` }]}>
      <View style={styles.cardTop}>
        <View style={styles.cardMain}>
          <Text style={styles.cardLabel}>{category.label}</Text>
          <View style={styles.metaRow}>
            <Ionicons name={targetIcon(category.target_type)} size={12} color="#888" />
            <Text style={styles.metaText}>{targetLabel(category.target_type)}</Text>
          </View>
        </View>
        <View style={[styles.voteBtn, { backgroundColor: `${accentColor}20`, borderColor: accentColor }]}>
          <Text style={[styles.voteBtnText, { color: accentColor }]}>Vote</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  suggestBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10,
  },
  suggestBtnText: { fontSize: 13, fontWeight: '700' },
  loadingBox: { paddingVertical: 16, alignItems: 'center' },
  emptyBox: {
    paddingVertical: 28,
    alignItems: 'center', gap: 8,
    backgroundColor: '#111111', borderRadius: 14,
  },
  emptyText: { color: '#888888', fontSize: 14, fontWeight: '600' },
  emptySubtext: { color: '#555555', fontSize: 12, paddingHorizontal: 20, textAlign: 'center' },
  list: { gap: 10 },
  groupLabel: {
    fontSize: 11, color: '#666',
    textTransform: 'uppercase', letterSpacing: 0.7,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#2A2A2A',
    gap: 10,
  },
  cardLive: { backgroundColor: '#161616' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardMain: { flex: 1 },
  cardLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  metaText: { color: '#888888', fontSize: 12 },
  metaDot: { color: '#444', fontSize: 12 },
  upvoteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1, borderColor: '#2A2A2A',
    backgroundColor: '#111111',
  },
  upvoteBtnActive: { backgroundColor: '#FF6B35', borderColor: '#FF6B35' },
  upvoteCount: { color: '#CCCCCC', fontWeight: '700', fontSize: 13 },
  progressTrack: {
    height: 3, borderRadius: 2,
    backgroundColor: '#2A2A2A',
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  voteBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  voteBtnText: { fontSize: 13, fontWeight: '700' },
});
