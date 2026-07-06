type CacheEntry<T = unknown> = {
  data: T;
  timestamp: number;
};

type Listener = () => void;

const store = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<Listener>>();

const DEFAULT_TTL = 15 * 60 * 1000;

function get<T>(key: string, ttl = DEFAULT_TTL): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

function set<T>(key: string, data: T): void {
  store.set(key, { data, timestamp: Date.now() });
}

function invalidate(...keys: string[]): void {
  for (const key of keys) {
    store.delete(key);
    const subs = listeners.get(key);
    if (subs) {
      for (const fn of subs) fn();
    }
  }
}

function subscribe(key: string, fn: Listener): () => void {
  let subs = listeners.get(key);
  if (!subs) {
    subs = new Set();
    listeners.set(key, subs);
  }
  subs.add(fn);
  return () => { subs!.delete(fn); };
}

function clear(): void {
  store.clear();
}

export const cache = { get, set, invalidate, subscribe, clear };
