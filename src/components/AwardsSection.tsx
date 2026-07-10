import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InfoTooltip from './InfoTooltip';
import LoadingBrand from './LoadingBrand';
import RetryPrompt from './RetryPrompt';
import { useLoadingTimeout } from '../hooks/useLoadingTimeout';
import { transformAvatarUrl } from '../lib/avatarUrl';
import { Animated, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { cache } from '../lib/cache';
import { useTheme } from '../context/ThemeContext';
import { SuperlativeTargetType } from '../types/database';
import { useListItemEntrance } from '../lib/animations';
import { fetchAwardsData, CategoryUI, WinnerRow } from '../lib/awardsData';
import SuggestCategoryModal from './SuggestCategoryModal';
import VoteSheet, { VoteSheetMedia, VoteSheetMember, CurrentVote } from './VoteSheet';

function haptic(kind: 'light' | 'medium' | 'success') {
  if (Platform.OS === 'web') return;
  if (kind === 'success') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } else {
    Haptics.impactAsync(
      kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
    );
  }
}

type Props = {
  capsuleId: string;
  joinedMemberCount: number;
  members: VoteSheetMember[];
  media: VoteSheetMedia[];
  votingClosesAt: string | null;
  votingFinalizedAt: string | null;
};

export default function AwardsSection({
  capsuleId, joinedMemberCount, members, media,
  votingClosesAt, votingFinalizedAt,
}: Props) {
  const { accentColor } = useTheme();
  const session = sessionStore.get();
  const userId = session?.user.id;

  const [categories, setCategories] = useState<CategoryUI[]>([]);
  // Mirrors `categories` for synchronous reads inside the realtime callback
  // below, without making the channel-setup effect depend on `categories`
  // (which would tear down and resubscribe the channel on every update).
  const categoryIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    categoryIdsRef.current = new Set(categories.map(c => c.id));
  }, [categories]);
  const [winners, setWinners] = useState<WinnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { timedOut, reset: resetTimeout } = useLoadingTimeout(loading);
  const [showSuggest, setShowSuggest] = useState(false);
  const [voteFor, setVoteFor] = useState<CategoryUI | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const threshold = Math.max(1, Math.ceil(joinedMemberCount / 2));
  const isFinalized = !!votingFinalizedAt;
  // isClosed derives from `nowTick`, not a bare Date.now() read at render time,
  // so the one-shot timer below can actually force the open->"Tallying…"
  // transition live instead of waiting for some other event (realtime
  // message, refocus, manual refresh) to trigger a re-render.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const isClosed = !!votingClosesAt && new Date(votingClosesAt).getTime() <= nowTick;

  useEffect(() => {
    if (!votingClosesAt) return;
    const msUntilClose = new Date(votingClosesAt).getTime() - Date.now();
    if (msUntilClose <= 0) return; // already closed — isClosed is already true
    // setTimeout's delay is a 32-bit signed int (~24.8 days); cap it so a
    // long voting window (up to 720h) can't overflow into an immediate fire.
    const timer = setTimeout(() => setNowTick(Date.now()), Math.min(msUntilClose + 250, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [votingClosesAt]);

  // Thin wrapper — the actual fetch/shape/cache-write logic lives in
  // fetchAwardsData (src/lib/awardsData.ts) so CapsuleDetailScreen can also
  // fire it as a prefetch at mount time, in parallel with its own load(),
  // instead of Awards only starting its fetch once it finally mounts behind
  // the parent's loading gate (see the "Awards always takes longer" fix).
  const fetchCategories = useCallback(async () => {
    const result = await fetchAwardsData(capsuleId, userId);
    if (result) {
      setCategories(result.categories);
      setWinners(result.winners);
    }
    setLoading(false);
  }, [capsuleId, userId]);

  useEffect(() => {
    // Instant-render path: seed from cache (if present) so this section
    // doesn't always show a fresh loading spinner on mount, then refresh in
    // the background regardless — mirrors CapsuleDetailScreen's own
    // cache.get-then-load() pattern.
    const cached = cache.get<{ categories: CategoryUI[]; winners: WinnerRow[] }>(`awards:${capsuleId}`);
    if (cached) {
      setCategories(cached.categories);
      setWinners(cached.winners);
      setLoading(false);
    }
    fetchCategories();
    const channel = supabase
      .channel(`awards-${capsuleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'superlative_categories', filter: `capsule_id=eq.${capsuleId}` },
        () => fetchCategories(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'superlative_winners' },
        payload => {
          // superlative_winners has no capsule_id column to filter on
          // server-side, so gate in JS against this section's own category
          // IDs — otherwise any capsule's winner insert refetches every
          // mounted AwardsSection instance.
          const newCategoryId = (payload.new as { category_id?: string })?.category_id;
          if (newCategoryId && categoryIdsRef.current.has(newCategoryId)) fetchCategories();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [capsuleId, fetchCategories]);

  // Re-fetch when finalization arrives via the parent's capsule subscription.
  useEffect(() => {
    if (votingFinalizedAt) fetchCategories();
  }, [votingFinalizedAt, fetchCategories]);

  // Success haptic when results first reveal — once per mount lifetime.
  const revealHapticFired = useRef(false);
  useEffect(() => {
    if (isFinalized && !revealHapticFired.current) {
      revealHapticFired.current = true;
      haptic('success');
    }
  }, [isFinalized]);

  async function toggleUpvote(c: CategoryUI) {
    if (!userId || busyIds.has(c.id)) return;
    setBusyIds(prev => new Set(prev).add(c.id));
    haptic('light');

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

    if (failed || !wasUpvoted) {
      // On error → resync; on success-insert → trigger may have promoted, resync.
      await fetchCategories();
    }
  }

  const pending = useMemo(() => categories.filter(c => c.status === 'pending'), [categories]);
  const live = useMemo(() => categories.filter(c => c.status === 'live'), [categories]);

  const memberById = useMemo(() => {
    const map = new Map<string, VoteSheetMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const mediaById = useMemo(() => {
    const map = new Map<string, VoteSheetMedia>();
    for (const m of media) map.set(m.id, m);
    return map;
  }, [media]);

  const winnersByCategory = useMemo(() => {
    const map = new Map<string, WinnerRow[]>();
    for (const w of winners) {
      const arr = map.get(w.category_id) ?? [];
      arr.push(w);
      map.set(w.category_id, arr);
    }
    return map;
  }, [winners]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Awards</Text>
          <InfoTooltip
            title="Awards"
            body={"Yearbook-style awards for your capsule.\n\nTap 'Suggest' to propose a category (e.g. 'Best Photo', 'Most Likely To…'). Once enough members upvote a suggestion, voting opens.\n\nVoting is anonymous — you can only see your own picks until the window closes. Winners are revealed when the voting period ends."}
            size={18}
            color="#555555"
          />
        </View>
        {!isClosed && (
          <TouchableOpacity
            style={[styles.suggestBtn, { backgroundColor: `${accentColor}20` }]}
            onPress={() => setShowSuggest(true)}
          >
            <Ionicons name="add" size={16} color={accentColor} />
            <Text style={[styles.suggestBtnText, { color: accentColor }]}>Suggest</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          {timedOut ? (
            <RetryPrompt compact onRetry={() => { resetTimeout(); fetchCategories(); }} />
          ) : (
            <LoadingBrand size="medium" color={accentColor} />
          )}
        </View>
      ) : isFinalized ? (
        live.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="trophy-outline" size={28} color="#555" />
            <Text style={styles.emptyText}>No awards this time — that's okay.</Text>
            <Text style={styles.emptySubtext}>
              No categories reached the upvote threshold while voting was open. The memories still made it.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.groupLabel}>🏆 Winners</Text>
            {live.map((c, i) => (
              <WinnerCard
                key={c.id}
                category={c}
                winners={winnersByCategory.get(c.id) ?? []}
                memberById={memberById}
                mediaById={mediaById}
                index={i}
              />
            ))}
          </View>
        )
      ) : isClosed ? (
        <View style={styles.tallyingBox}>
          <LoadingBrand size="medium" color={accentColor} />
          <Text style={styles.emptyText}>Tallying votes…</Text>
          <Text style={styles.emptySubtext}>Winners will appear here in a moment.</Text>
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
                <LiveCard
                  key={c.id}
                  category={c}
                  memberById={memberById}
                  mediaById={mediaById}
                  onPress={() => setVoteFor(c)}
                />
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

      <VoteSheet
        visible={voteFor !== null}
        category={voteFor}
        members={members}
        media={media}
        currentVote={voteFor?.my_vote ?? null}
        onClose={() => setVoteFor(null)}
        onSaved={fetchCategories}
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
          accessibilityRole="button"
          accessibilityLabel={category.i_upvoted ? `Remove upvote for "${category.label}"` : `Upvote "${category.label}"`}
        >
          <Ionicons
            name={category.i_upvoted ? 'checkmark' : 'arrow-up-outline'}
            size={16}
            color={category.i_upvoted ? '#FFFFFF' : '#888'}
          />
          <Text style={[styles.upvoteCount, category.i_upvoted && { color: '#FFFFFF' }]}>
            {category.upvote_count}
          </Text>
          {category.i_upvoted && (
            <View style={styles.upvoteRemove}>
              <Ionicons name="close" size={11} color="#FFFFFF" />
            </View>
          )}
        </TouchableOpacity>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: accentColor }]} />
      </View>
    </View>
  );
}

function LiveCard({
  category, memberById, mediaById, onPress,
}: {
  category: CategoryUI;
  memberById: Map<string, VoteSheetMember>;
  mediaById: Map<string, VoteSheetMedia>;
  onPress: () => void;
}) {
  const { accentColor } = useTheme();
  const vote = category.my_vote;
  const votedPerson = vote?.target_user_id ? memberById.get(vote.target_user_id) : null;
  const votedMedia = vote?.target_media_id ? mediaById.get(vote.target_media_id) : null;
  const hasVote = !!votedPerson || !!votedMedia;

  return (
    <TouchableOpacity
      style={[styles.card, styles.cardLive, { borderColor: `${accentColor}40` }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardMain}>
          <Text style={styles.cardLabel}>{category.label}</Text>
          <View style={styles.metaRow}>
            <Ionicons name={targetIcon(category.target_type)} size={12} color="#888" />
            <Text style={styles.metaText}>{targetLabel(category.target_type)}</Text>
          </View>
        </View>
        {hasVote ? (
          <View style={[styles.votedPill, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]}>
            <Ionicons name="checkmark" size={12} color={accentColor} />
            <Text style={[styles.votedPillText, { color: accentColor }]}>Change</Text>
          </View>
        ) : (
          <View style={[styles.voteBtn, { backgroundColor: `${accentColor}20`, borderColor: accentColor }]}>
            <Text style={[styles.voteBtnText, { color: accentColor }]}>Vote</Text>
          </View>
        )}
      </View>

      {hasVote && (
        <View style={styles.votedRow}>
          <Text style={styles.votedLabel}>Your vote:</Text>
          {votedPerson && (
            <View style={styles.votedPerson}>
              <View style={[styles.votedAvatar, { backgroundColor: `${accentColor}30` }]}>
                {votedPerson.avatar_url ? (
                  <Image source={transformAvatarUrl(votedPerson.avatar_url, 22)} style={styles.votedAvatarImg} contentFit="cover" />
                ) : (
                  <Text style={[styles.votedAvatarLetter, { color: accentColor }]}>
                    {(votedPerson.display_name || '?').slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <Text style={styles.votedName}>{votedPerson.display_name || 'Member'}</Text>
            </View>
          )}
          {votedMedia && (
            <View style={styles.votedMedia}>
              {(votedMedia.mediaType === 'video' ? votedMedia.thumbnailUri : votedMedia.signedUrl) ? (
                <Image
                  source={votedMedia.mediaType === 'video' ? votedMedia.thumbnailUri : votedMedia.signedUrl}
                  style={styles.votedMediaImg}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.votedMediaImg, { backgroundColor: '#222' }]} />
              )}
              <Text style={styles.votedName}>
                {votedMedia.mediaType === 'video' ? 'Video' : 'Photo'}
              </Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

function WinnerCard({
  category, winners, memberById, mediaById, index,
}: {
  category: CategoryUI;
  winners: WinnerRow[];
  memberById: Map<string, VoteSheetMember>;
  mediaById: Map<string, VoteSheetMedia>;
  index: number;
}) {
  const { accentColor } = useTheme();
  const anim = useListItemEntrance(index, 40);

  const totalVotes = winners.reduce((sum, w) => sum + w.vote_count, 0);
  const isTie = winners.length > 1;

  return (
    <Animated.View style={[styles.winnerCard, { borderColor: `${accentColor}50`, shadowColor: accentColor }, anim]}>
      <View style={styles.winnerHeader}>
        <View style={styles.winnerCrown}>
          <Ionicons name="trophy" size={14} color={accentColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.winnerCategoryLabel}>{category.label}</Text>
          {isTie && (
            <Text style={[styles.tieLabel, { color: accentColor }]}>Co-winners</Text>
          )}
        </View>
      </View>

      {winners.length === 0 ? (
        <View style={styles.noVotesBox}>
          <Text style={styles.noVotesText}>No votes were cast.</Text>
        </View>
      ) : (
        <View style={styles.winnersList}>
          {winners.map((w, i) => (
            <WinnerEntry
              key={i}
              targetType={category.target_type}
              winner={w}
              memberById={memberById}
              mediaById={mediaById}
            />
          ))}
        </View>
      )}

      {winners.length > 0 && (
        <Text style={styles.winnerMeta}>
          {winners[0].vote_count} {winners[0].vote_count === 1 ? 'vote' : 'votes'}
          {isTie ? ' each' : ''} · {totalVotes} {isTie ? 'shared' : 'total'}
        </Text>
      )}
    </Animated.View>
  );
}

function WinnerEntry({
  targetType, winner, memberById, mediaById,
}: {
  targetType: SuperlativeTargetType;
  winner: WinnerRow;
  memberById: Map<string, VoteSheetMember>;
  mediaById: Map<string, VoteSheetMedia>;
}) {
  const { accentColor } = useTheme();

  if (targetType === 'person') {
    const m = winner.target_user_id ? memberById.get(winner.target_user_id) : null;
    return (
      <View style={styles.winnerEntry}>
        <View style={[styles.winnerAvatar, { backgroundColor: `${accentColor}30`, borderColor: accentColor }]}>
          {m?.avatar_url ? (
            <Image source={transformAvatarUrl(m.avatar_url, 36)} style={styles.winnerAvatarImg} contentFit="cover" />
          ) : (
            <Text style={[styles.winnerAvatarLetter, { color: accentColor }]}>
              {(m?.display_name || '?').slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <Text style={styles.winnerName}>{m?.display_name || 'Member'}</Text>
      </View>
    );
  }

  const item = winner.target_media_id ? mediaById.get(winner.target_media_id) : null;
  const src = item ? (item.mediaType === 'video' ? item.thumbnailUri : item.signedUrl) : undefined;
  return (
    <View style={styles.winnerEntry}>
      <View style={[styles.winnerThumb, { borderColor: accentColor }]}>
        {src ? (
          <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#222' }]} />
        )}
        {item?.mediaType === 'video' && (
          <View style={styles.winnerPlayBadge}>
            <Ionicons name="play" size={12} color="#FFFFFF" />
          </View>
        )}
      </View>
      <Text style={styles.winnerName}>{item?.mediaType === 'video' ? 'Video' : 'Photo'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  emptySubtext: { color: '#888888', fontSize: 12, paddingHorizontal: 20, textAlign: 'center' },
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
  upvoteRemove: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
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
  votedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  votedPillText: { fontSize: 12, fontWeight: '700' },
  votedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#2A2A2A',
  },
  votedLabel: { color: '#888', fontSize: 12, fontWeight: '600' },
  votedPerson: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  votedAvatar: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  votedAvatarImg: { width: 22, height: 22, borderRadius: 11 },
  votedAvatarLetter: { fontSize: 11, fontWeight: '800' },
  votedMedia: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  votedMediaImg: { width: 22, height: 22, borderRadius: 6 },
  votedName: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  tallyingBox: {
    paddingVertical: 28, alignItems: 'center', gap: 10,
    backgroundColor: '#111111', borderRadius: 14,
  },
  winnerCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1,
    gap: 12,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  winnerHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  winnerCrown: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(255,107,53,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  winnerCategoryLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  tieLabel: { fontSize: 11, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  noVotesBox: { paddingVertical: 12, alignItems: 'center' },
  noVotesText: { color: '#888888', fontSize: 13 },
  winnersList: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  winnerEntry: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  winnerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  winnerAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  winnerAvatarLetter: { fontSize: 16, fontWeight: '800' },
  winnerThumb: {
    width: 40, height: 40, borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
  },
  winnerPlayBadge: {
    position: 'absolute', bottom: 2, right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
    paddingHorizontal: 3, paddingVertical: 1,
  },
  winnerName: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  winnerMeta: { color: '#666', fontSize: 11, fontWeight: '600' },
});
