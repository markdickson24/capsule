export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
};

export type AppTabParamList = {
  Home: undefined;
  Create: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: undefined;
  CapsuleDetail: { capsuleId: string };
};

export type RootStackParamList = {
  Auth: undefined;
  App: undefined;
  CapsuleDetail: { capsuleId: string };
};
