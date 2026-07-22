// Global imperative "you hit a limit" sheet — mirrors src/lib/toast.ts so
// non-component code (proGateHit, the Preview video gate) can trigger a smooth
// in-app sheet. Rendered once by <LimitSheetHost> near the app root.

export type LimitAction = {
  label: string;
  style?: 'primary' | 'secondary' | 'destructive';
  onPress: () => void;
};

export type LimitSheetConfig = {
  title: string;
  message: string;
  icon?: string; // Ionicons name
  actions: LimitAction[];
};

type LimitSheetState = LimitSheetConfig & { id: number };

let current: LimitSheetState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export const limitSheet = {
  get: (): LimitSheetState | null => current,

  show(config: LimitSheetConfig) {
    current = { ...config, id: ++seq };
    notify();
  },

  hide() {
    current = null;
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
