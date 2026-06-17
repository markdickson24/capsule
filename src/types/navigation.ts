export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
};

export type PendingMedia = {
  uri: string;
  mediaType: 'photo' | 'video';
  /** PiP dual photos only: the swapped (front-main) composite, uploaded as alt_storage_key. */
  altUri?: string;
};

export type AppTabParamList = {
  Home: undefined;
  Create: { presetTitle?: string; presetDescription?: string; pendingMedia?: PendingMedia[] } | undefined;
  Camera: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen: keyof AppTabParamList; params?: AppTabParamList[keyof AppTabParamList] } | undefined;
  CapsuleDetail: { capsuleId: string };
  PublicProfile: { userId: string };
  Preview:
    | { uri: string; mediaType: 'photo' | 'video'; facing?: 'front' | 'back'; altUri?: string }
    | { media: PendingMedia[]; source?: 'share' | 'camera' };
  ResetPassword: undefined;
  EditCapsule: { capsuleId: string };
  ManageMembers: { capsuleId: string };
  Settings: undefined;
  Onboarding: undefined;
  Friends: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  CapsuleDetail: { capsuleId: string };
};
