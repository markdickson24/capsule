// Tiny global toast: a module-level current message + pub/sub, rendered once by
// <ToastHost> near the app root so it overlays every screen and survives the
// navigation that happens right after an upload completes. Call toast.show(...)
// from anywhere (including non-component code).

export type Toast = { id: number; message: string };

let current: Toast | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export const toast = {
  get: (): Toast | null => current,

  /** Show a transient confirmation. The host animates it in and auto-dismisses. */
  show(message: string) {
    current = { id: ++seq, message };
    notify();
  },

  /** Cleared by the host once its dismiss animation finishes. */
  clear() {
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
