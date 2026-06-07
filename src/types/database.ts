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

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  auth_provider: string;
  subscription_tier: SubscriptionTier;
  created_at: string;
  push_token: string | null;
  bio: string | null;
  accent_color: string;
  onboarded_at: string | null;
}

export interface Capsule {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  unlock_at: string;
  contribution_lock_at: string | null;
  status: CapsuleStatus;
  visibility: CapsuleVisibility;
  created_at: string;
  archived_at: string | null;
  unlock_mode: UnlockMode;
  proximity_radius_m: number;
  unlocked_at: string | null;
  superlative_voting_hours: number;
  superlative_voting_closes_at: string | null;
}

export interface CapsuleMember {
  id: string;
  capsule_id: string;
  user_id: string;
  role: MemberRole;
  invited_at: string;
  joined_at: string | null;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_at: string | null;
}

export interface Media {
  id: string;
  capsule_id: string;
  uploader_id: string;
  storage_key: string;
  media_type: MediaType;
  size_bytes: number;
  thumbnail_key: string | null;
  uploaded_at: string;
  is_flagged: boolean;
}

export interface Reaction {
  id: string;
  media_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  capsule_id: string;
  type: NotificationType;
  sent_at: string;
  read_at: string | null;
}

export interface SuperlativeCategory {
  id: string;
  capsule_id: string;
  suggested_by: string;
  label: string;
  target_type: SuperlativeTargetType;
  status: SuperlativeStatus;
  promoted_at: string | null;
  created_at: string;
}

export interface SuperlativeUpvote {
  category_id: string;
  user_id: string;
  created_at: string;
}

export interface SuperlativeVote {
  category_id: string;
  voter_id: string;
  target_user_id: string | null;
  target_media_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuperlativeTally {
  category_id: string;
  target_user_id: string | null;
  target_media_id: string | null;
  vote_count: number;
}
