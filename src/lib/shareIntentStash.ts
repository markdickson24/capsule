import { PendingMedia } from '../types/navigation';

let stashed: PendingMedia[] | null = null;

export const shareIntentStash = {
  set(media: PendingMedia[]) {
    if (media.length === 0) return;
    // Append rather than replace — a second share arriving before the user
    // signs in must not silently discard the first one's media.
    stashed = [...(stashed ?? []), ...media];
  },
  get(): PendingMedia[] | null {
    return stashed;
  },
  clear() {
    stashed = null;
  },
};
