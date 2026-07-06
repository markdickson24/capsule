import { supabase } from './supabase';
import { cache } from './cache';
import { SuperlativeStatus, SuperlativeTargetType } from '../types/database';
import type { CurrentVote } from '../components/VoteSheet';

export type WinnerRow = {
  category_id: string;
  target_user_id: string | null;
  target_media_id: string | null;
  vote_count: number;
};

export type CategoryRow = {
  id: string;
  label: string;
  target_type: SuperlativeTargetType;
  status: SuperlativeStatus;
  created_at: string;
  is_default: boolean;
};

export type CategoryUI = CategoryRow & {
  upvote_count: number;
  i_upvoted: boolean;
  my_vote: CurrentVote | null;
};

// Pure fetch + shape + cache-write, extracted out of AwardsSection so it can
// also be called as a fire-and-forget prefetch from CapsuleDetailScreen's
// mount effect (starting at t0, in parallel with the parent's own load(),
// instead of only after AwardsSection itself finally mounts — see the
// "Awards always takes longer" fix). Returns null on a query error (and does
// NOT write cache, matching the original error-path behavior); returns the
// real shape — including a legitimate zero-categories result, which still
// writes cache — on success.
export async function fetchAwardsData(
  capsuleId: string,
  userId: string | undefined,
): Promise<{ categories: CategoryUI[]; winners: WinnerRow[] } | null> {
  const { data: cats, error: catErr } = await supabase
    .from('superlative_categories')
    .select('id, label, target_type, status, created_at, is_default')
    .eq('capsule_id', capsuleId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  if (catErr) return null;

  const rows = (cats ?? []) as CategoryRow[];
  const catIds = rows.map(c => c.id);

  let upvotes: { category_id: string; user_id: string }[] = [];
  let myVotes: { category_id: string; target_user_id: string | null; target_media_id: string | null }[] = [];
  let winnerRows: WinnerRow[] = [];
  if (catIds.length > 0) {
    // Winners only depends on catIds (known after the categories fetch
    // above), not on the upvotes/myVotes results — fold it into the same
    // wave instead of fetching it afterward.
    const [{ data: upData }, { data: voteData }, { data: winData }] = await Promise.all([
      supabase
        .from('superlative_upvotes')
        .select('category_id, user_id')
        .in('category_id', catIds),
      userId
        ? supabase
            .from('superlative_votes')
            .select('category_id, target_user_id, target_media_id')
            .eq('voter_id', userId)
            .in('category_id', catIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('superlative_winners')
        .select('category_id, target_user_id, target_media_id, vote_count')
        .in('category_id', catIds),
    ]);
    upvotes = (upData ?? []) as typeof upvotes;
    myVotes = (voteData ?? []) as typeof myVotes;
    winnerRows = (winData ?? []) as WinnerRow[];
  }

  const upvoteById = new Map<string, { count: number; mine: boolean }>();
  for (const u of upvotes) {
    const cur = upvoteById.get(u.category_id) ?? { count: 0, mine: false };
    cur.count += 1;
    if (u.user_id === userId) cur.mine = true;
    upvoteById.set(u.category_id, cur);
  }

  const voteById = new Map<string, CurrentVote>();
  for (const v of myVotes) {
    voteById.set(v.category_id, {
      target_user_id: v.target_user_id,
      target_media_id: v.target_media_id,
    });
  }

  const categories = rows.map(r => ({
    ...r,
    upvote_count: upvoteById.get(r.id)?.count ?? 0,
    i_upvoted: upvoteById.get(r.id)?.mine ?? false,
    my_vote: voteById.get(r.id) ?? null,
  }));

  cache.set(`awards:${capsuleId}`, { categories, winners: winnerRows });

  return { categories, winners: winnerRows };
}
