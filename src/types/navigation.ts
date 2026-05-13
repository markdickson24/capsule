export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Create: undefined;
  Camera: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen: keyof AppTabParamList } | undefined;
  CapsuleDetail: { capsuleId: string };
  PublicProfile: { userId: string };
  Preview: { uri: string; mediaType: 'photo' | 'video'; facing?: 'front' | 'back' };
  ResetPassword: undefined;
  EditCapsule: { capsuleId: string };
  ManageMembers: { capsuleId: string };
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  CapsuleDetail: { capsuleId: string };
};
