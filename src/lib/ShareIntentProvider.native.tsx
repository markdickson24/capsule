import React from 'react';
import { ShareIntentProvider as NativeShareIntentProvider } from 'expo-share-intent';

export function ShareIntentProvider({ children }: { children: React.ReactNode }) {
  return <NativeShareIntentProvider>{children}</NativeShareIntentProvider>;
}
