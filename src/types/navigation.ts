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
};

export type AppTabParamList = {
  Home: undefined;
  Create: { presetTitle?: string; presetDescription?: string; pendingMedia?: PendingMedia[]; groupId?: string; groupUnlockHours?: number } | undefined;
  Camera: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen: keyof AppTabParamList; params?: AppTabParamList[keyof AppTabParamList] } | undefined;
  CapsuleDetail: { capsuleId: string; justCreated?: boolean };
  PublicProfile: { userId: string };
  Preview:
    | { uri: string; mediaType: 'photo' | 'video'; facing?: 'front' | 'back'; altUri?: string }
    | { media: PendingMedia[]; source?: 'share' | 'camera'; targetCapsuleId?: string };
  ResetPassword: undefined;
  EditCapsule: { capsuleId: string };
  ManageMembers: { capsuleId: string };
  Settings: undefined;
  BlockedUsers: undefined;
  Onboarding: undefined;
  Friends: undefined;
  QRScanner: undefined;
  GroupDetail: { groupId: string };
  ManageGroup: { groupId: string };
  CreateGroup: undefined;
  CreateCapsule: { groupId?: string; groupUnlockHours?: number; presetTitle?: string; presetDescription?: string; pendingMedia?: PendingMedia[] } | undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  CapsuleDetail: { capsuleId: string; justCreated?: boolean };
};
