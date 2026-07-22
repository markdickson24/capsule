// Public type surface used throughout the app. Row shapes are derived from
// the auto-generated Supabase types in ./supabase. Literal-union aliases for
// enum-like columns (status, role, type, etc.) are kept here for type safety
// at call sites — the DB check constraints enforce the same set of values.

import type { Tables, TablesInsert, TablesUpdate } from './supabase';

// ---------- Literal-union aliases (DB check constraints enforce these) ----------

export type SubscriptionTier = 'free' | 'pro';
export type CapsuleStatus = 'draft' | 'active' | 'unlocked';
export type CapsuleVisibility = 'private' | 'invite';
export type MemberRole = 'owner' | 'contributor' | 'viewer';
export type MediaType = 'photo' | 'video';
export type UnlockMode = 'time' | 'proximity' | 'both';
export type NotificationType =
  | 'invite'
  | 'unlock'
  | 'contribution_nudge'
  | 'milestone'
  | 'reaction'
  | 'superlative_suggested'
  | 'superlative_closing_soon'
  | 'superlative_won';
export type SuperlativeStatus = 'pending' | 'live' | 'archived';
export type SuperlativeTargetType = 'person' | 'media';
export type CapsuleOccasion = 'wedding' | 'vacation' | 'party' | 'baby' | 'milestone' | 'general';

// ---------- Row shapes (generated) — narrowed to the literal-union aliases ----------

export type User = Tables<'users'> & { subscription_tier: SubscriptionTier; accent_gradient: string | null };
export type Capsule = Tables<'capsules'> & {
  status: CapsuleStatus;
  visibility: CapsuleVisibility;
  unlock_mode: UnlockMode;
  occasion: CapsuleOccasion;
};
export type CapsuleMember = Tables<'capsule_members'> & { role: MemberRole };
export type Media = Tables<'media'> & { media_type: MediaType };
export type Reaction = Tables<'reactions'>;
export type Notification = Tables<'notifications'> & { type: NotificationType };

export type SuperlativeCategory = Tables<'superlative_categories'> & {
  target_type: SuperlativeTargetType;
  status: SuperlativeStatus;
};
export type SuperlativeUpvote = Tables<'superlative_upvotes'>;
export type SuperlativeVote = Tables<'superlative_votes'>;
export type SuperlativeWinner = Tables<'superlative_winners'>;

// tally_superlatives RPC return type (not derived from a table)
export interface SuperlativeTally {
  category_id: string;
  target_user_id: string | null;
  target_media_id: string | null;
  vote_count: number;
}

// Insert / Update helpers re-exported for screens that need them
export type CapsuleInsert = TablesInsert<'capsules'>;
export type CapsuleUpdate = TablesUpdate<'capsules'>;
export type CapsuleMemberInsert = TablesInsert<'capsule_members'>;
export type MediaInsert = TablesInsert<'media'>;
export type NotificationInsert = TablesInsert<'notifications'>;
export type SuperlativeCategoryInsert = TablesInsert<'superlative_categories'>;
export type SuperlativeUpvoteInsert = TablesInsert<'superlative_upvotes'>;
export type SuperlativeVoteInsert = TablesInsert<'superlative_votes'>;

export type Group = Tables<'groups'>;
export type GroupMember = Tables<'group_members'>;
export type GroupInsert = TablesInsert<'groups'>;
export type GroupMemberInsert = TablesInsert<'group_members'>;
