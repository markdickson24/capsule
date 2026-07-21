export type AuthStackParamList = {
  Welcome: undefined;
  Login: { email?: string } | undefined;
  SignUp: undefined;
};

export type PendingMedia = {
  uri: string;
  mediaType: 'photo' | 'video';
  /** PiP dual photos only: the swapped (front-main) composite, uploaded as alt_storage_key. */
  altUri?: string;
  caption?: string;
  /** Real source mimeType when known (picker/share-intent) — lets uploadQueue derive a
   * coherent storage-key extension/Content-Type instead of falling back to a guessed default. */
  mimeType?: string;
  /** Video length in ms when known (camera recording length / picker asset.duration).
   * Unset = unknown (share intent) → not length-gated (fail-open). */
  durationMs?: number;
};

export type AppTabParamList = {
  Home: undefined;
  Create: { presetTitle?: string; presetDescription?: string; pendingMedia?: PendingMedia[]; groupId?: string; groupUnlockHours?: number } | undefined;
  // targetCapsuleId: set by CapsuleDetail's "Open Camera" picker option so a
  // capture made from a specific capsule preselects that capsule on Preview.
  // Cleared by CameraScreen on blur so a later direct tab visit isn't sticky.
  Camera: { targetCapsuleId?: string } | undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen: keyof AppTabParamList; params?: AppTabParamList[keyof AppTabParamList] } | undefined;
  CapsuleDetail: { capsuleId: string; justCreated?: boolean };
  PublicProfile: { userId: string };
  Preview:
    | { uri: string; mediaType: 'photo' | 'video'; facing?: 'front' | 'back'; altUri?: string; targetCapsuleId?: string }
    | { media: PendingMedia[]; source?: 'share' | 'camera'; targetCapsuleId?: string };
  ResetPassword: undefined;
  EditCapsule: { capsuleId: string };
  ManageMembers: { capsuleId: string };
  Settings: undefined;
  BlockedUsers: undefined;
  Onboarding: undefined;
  Friends: undefined;
  QRScanner: undefined;
  GroupDetail: { groupId: string; justCreated?: boolean };
  ManageGroup: { groupId: string };
  CreateGroup: undefined;
  CreateCapsule: { groupId?: string; groupUnlockHours?: number; presetTitle?: string; presetDescription?: string; pendingMedia?: PendingMedia[] } | undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  CapsuleDetail: { capsuleId: string; justCreated?: boolean };
};
