import React, { createContext, useContext, useCallback, useRef, useState } from 'react';
import { navigationRef } from '../lib/navigationRef';
import { buildTourSteps, TourStep } from '../lib/tourSteps';
import { waitForTarget, Rect, MeasureFn } from '../lib/waitForTarget';
import { markTourSeen } from '../lib/tourStorage';
import TourOverlay from '../components/TourOverlay';

type TourContextType = {
  active: boolean;
  steps: TourStep[];
  stepIndex: number;
  currentRect: Rect | null;
  startTour: (steps: TourStep[]) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  registerTarget: (id: string, fn: MeasureFn) => void;
  unregisterTarget: (id: string) => void;
};

const noop = () => {};
const TourContext = createContext<TourContextType>({
  active: false, steps: [], stepIndex: 0, currentRect: null,
  startTour: noop, next: noop, back: noop, skip: noop,
  registerTarget: noop, unregisterTarget: noop,
});

// Measure a native node to window coordinates; resolves null if it's gone/zero-size.
export function measureNode(node: any): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    try {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        if (width > 0 && height > 0) resolve({ x, y, width, height });
        else resolve(null);
      });
    } catch { resolve(null); }
  });
}

function currentRouteName(): string | undefined {
  try { return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined; } catch { return undefined; }
}

function navigateForStep(step: TourStep) {
  if (!navigationRef.isReady()) return;
  if (currentRouteName() === step.screen) return;
  if (step.screen === 'Home') {
    (navigationRef.navigate as any)('Tabs', { screen: 'Home' });
  } else if (step.screen === 'CapsuleDetail') {
    (navigationRef.navigate as any)('CapsuleDetail', step.params);
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const registry = useRef(new Map<string, MeasureFn>()).current;
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const runToken = useRef(0); // invalidates in-flight goToStep when a new run/skip happens

  const registerTarget = useCallback((id: string, fn: MeasureFn) => { registry.set(id, fn); }, [registry]);
  const unregisterTarget = useCallback((id: string) => { registry.delete(id); }, [registry]);

  const finish = useCallback(() => {
    runToken.current++;
    setActive(false);
    setCurrentRect(null);
    markTourSeen();
  }, []);

  const goToStep = useCallback(async (list: TourStep[], i: number, token: number, skips: number) => {
    if (token !== runToken.current) return;            // superseded
    if (i < 0 || i >= list.length || skips > list.length) { finish(); return; }
    const step = list[i];
    // Clear the spotlight before a cross-screen hop so the previous step's hole/
    // tooltip doesn't linger over the incoming screen while its target measures.
    if (currentRouteName() !== step.screen) setCurrentRect(null);
    navigateForStep(step);
    if (step.targetId == null) { setStepIndex(i); setCurrentRect(null); return; } // finish card
    const rect = await waitForTarget(step.targetId, (id) => registry.get(id));
    if (token !== runToken.current) return;
    if (!rect) { goToStep(list, i + 1, token, skips + 1); return; }               // unmeasurable → skip
    setStepIndex(i); setCurrentRect(rect);
  }, [registry, finish]);

  const startTour = useCallback((list: TourStep[]) => {
    if (!list.length) return;
    const token = ++runToken.current;
    setSteps(list); setStepIndex(0); setCurrentRect(null); setActive(true);
    goToStep(list, 0, token, 0);
  }, [goToStep]);

  const next = useCallback(() => { goToStep(steps, stepIndex + 1, runToken.current, 0); }, [goToStep, steps, stepIndex]);
  const back = useCallback(() => { goToStep(steps, stepIndex - 1, runToken.current, 0); }, [goToStep, steps, stepIndex]);
  const skip = useCallback(() => { finish(); }, [finish]);

  return (
    <TourContext.Provider value={{ active, steps, stepIndex, currentRect, startTour, next, back, skip, registerTarget, unregisterTarget }}>
      {children}
      {active && <TourOverlay />}
    </TourContext.Provider>
  );
}

export function useTour() { return useContext(TourContext); }

// Stable callback ref: attach to any element to register it as a tour target.
export function useTourTarget(id: string): (node: any) => void {
  const { registerTarget, unregisterTarget } = useTour();
  return useCallback((node: any) => {
    if (node) registerTarget(id, () => measureNode(node));
    else unregisterTarget(id);
  }, [id, registerTarget, unregisterTarget]);
}

// Re-export for callers that build steps + start in one place.
export { buildTourSteps };
