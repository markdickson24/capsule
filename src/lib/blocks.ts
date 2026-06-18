import { supabase } from './supabase';
import { sessionStore } from './sessionStore';

// Module-level cache of the current user's blocked user IDs, with pub/sub so any
// screen can react when a block is added/removed. Blocking is enforced by
// client-side filtering (hiding the blocked user's media, reactions, and search
// hits); the rows live in `blocked_users` with owner-only RLS.
let blockedIds = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export const blockStore = {
  /** Current blocked-id set. Treat as read-only. */
  get: (): ReadonlySet<string> => blockedIds,
  has: (id: string | null | undefined): boolean => !!id && blockedIds.has(id),

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Reload the block list from the server for the signed-in user. */
  async refresh(): Promise<void> {
    const uid = sessionStore.get()?.user?.id;
    if (!uid) {
      if (blockedIds.size) { blockedIds = new Set(); notify(); }
      return;
    }
    const { data, error } = await supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', uid);
    if (error) return;
    blockedIds = new Set((data ?? []).map(r => r.blocked_id));
    notify();
  },

  async block(id: string): Promise<{ error?: string }> {
    const uid = sessionStore.get()?.user?.id;
    if (!uid) return { error: 'Not signed in' };
    if (uid === id) return { error: "You can't block yourself" };
    // Optimistic — reflect immediately, roll back on failure.
    blockedIds = new Set(blockedIds).add(id);
    notify();
    const { error } = await supabase
      .from('blocked_users')
      .insert({ blocker_id: uid, blocked_id: id });
    if (error && error.code !== '23505') { // ignore duplicate (already blocked)
      blockedIds = new Set(blockedIds); blockedIds.delete(id); notify();
      return { error: 'Could not block this user. Try again.' };
    }
    return {};
  },

  async unblock(id: string): Promise<{ error?: string }> {
    const uid = sessionStore.get()?.user?.id;
    if (!uid) return { error: 'Not signed in' };
    const next = new Set(blockedIds); next.delete(id);
    blockedIds = next;
    notify();
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', uid)
      .eq('blocked_id', id);
    if (error) {
      blockedIds = new Set(blockedIds).add(id); notify();
      return { error: 'Could not unblock this user. Try again.' };
    }
    return {};
  },

  /** Wipe local state (called on sign-out). */
  clear() {
    if (blockedIds.size) { blockedIds = new Set(); notify(); }
  },
};
