export type SubscriptionTier = 'free' | 'pro';
export type CapsuleStatus = 'draft' | 'active' | 'unlocked';
export type CapsuleVisibility = 'private' | 'invite';
export type MemberRole = 'owner' | 'contributor' | 'viewer';
export type MediaType = 'photo' | 'video';
export type NotificationType = 'invite' | 'unlock' | 'contribution_nudge' | 'milestone';

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  auth_provider: string;
  subscription_tier: SubscriptionTier;
  created_at: string;
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
}

export interface CapsuleMember {
  id: string;
  capsule_id: string;
  user_id: string;
  role: MemberRole;
  invited_at: string;
  joined_at: string | null;
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
