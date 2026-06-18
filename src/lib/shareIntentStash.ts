import { PendingMedia } from '../types/navigation';

let stashed: PendingMedia[] | null = null;

export const shareIntentStash = {
  set(media: PendingMedia[]) {
    stashed = media.length > 0 ? media : null;
  },
  get(): PendingMedia[] | null {
    return stashed;
  },
  clear() {
    stashed = null;
  },
};
