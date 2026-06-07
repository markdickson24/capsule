import { Session } from '@supabase/supabase-js';

export function useShareIntent(_session: Session | null) {
  // no-op on web — share intents are a native-only feature
}
