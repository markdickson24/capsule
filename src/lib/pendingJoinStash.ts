let stashed: string | null = null;

export const pendingJoinStash = {
  set(capsuleId: string) {
    stashed = capsuleId;
  },
  get(): string | null {
    return stashed;
  },
  clear() {
    stashed = null;
  },
};
