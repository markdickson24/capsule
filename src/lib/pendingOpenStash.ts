// A capsule:// open/camera deep link tapped while signed out. Module-level so
// it survives the AuthNavigator -> AppNavigator swap (it's a plain JS
// variable, not navigation state) — same idiom as pendingJoinStash and
// shareIntentStash.
export type PendingOpen = { capsuleId: string; camera: boolean };

let pending: PendingOpen | null = null;

export const pendingOpenStash = {
  set(value: PendingOpen) {
    pending = value;
  },
  get(): PendingOpen | null {
    return pending;
  },
  clear() {
    pending = null;
  },
};
