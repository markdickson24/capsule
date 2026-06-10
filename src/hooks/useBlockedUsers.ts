import { useEffect, useState } from 'react';
import { blockStore } from '../lib/blocks';

/**
 * Returns the current user's blocked-id set, kept in sync with `blockStore`.
 * Refreshes from the server on mount and re-renders whenever a block changes
 * anywhere in the app. Use `ids.has(userId)` to filter content client-side.
 */
export function useBlockedUsers(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(blockStore.get());

  useEffect(() => {
    blockStore.refresh();
    return blockStore.subscribe(() => setIds(new Set(blockStore.get())));
  }, []);

  return ids;
}
