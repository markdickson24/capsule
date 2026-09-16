import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { ThemeProvider } from '../src/context/ThemeContext';
import { TourProvider } from '../src/context/TourContext';

// A bare `render(<SomeScreen />)` throws
// "Couldn't find a navigation object. Is your component inside NavigationContainer?"
// because src/lib/animations.ts's useFadeIn/useSlideUp/useListItemEntrance call
// useIsFocused() (React Navigation), and screens like CapsuleDetailScreen use
// those hooks. TourProvider must sit INSIDE NavigationContainer (it drives
// navigationRef); ThemeProvider has no such requirement and sits outside.
const FRAME = { x: 0, y: 0, width: 390, height: 844 };
const INSETS = { top: 47, left: 0, right: 0, bottom: 34 };

export function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: FRAME, insets: INSETS }}>
      <ThemeProvider>
        <NavigationContainer>
          <TourProvider>{children}</TourProvider>
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
