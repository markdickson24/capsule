import { supabase } from './supabase';
import { sessionStore } from './sessionStore';

// Friendship helpers. A friendship is one row in `friendships` with a directional
// requester/addressee and a status of 'pending' or 'accepted'. The pair is unique
// regardless of direction, so there's at most one row per (me, other).

export type FriendStatus = 'none' | 'friends' | 'incoming' | 'outgoing';

export type FriendProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

function myId(): string | null {
  return sessionStore.get()?.user?.id ?? null;
}

/** Matches either direction of the pair (me↔other). */
function pairFilter(me: string, other: string): string {
  return `and(requester_id.eq.${me},addressee_id.eq.${other}),and(requester_id.eq.${other},addressee_id.eq.${me})`;
}

/** Where do I stand with this user? */
export async function getFriendStatus(otherId: string): Promise<FriendStatus> {
  const me = myId();
  if (!me || me === otherId) return 'none';
  const { data } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, status')
    .or(pairFilter(me, otherId))
    .maybeSingle();
  if (!data) return 'none';
  if (data.status === 'accepted') return 'friends';
  // pending — incoming if they requested me, outgoing if I requested them.
  return data.requester_id === me ? 'outgoing' : 'incoming';
}

export async function sendFriendRequest(otherId: string): Promise<{ error?: string }> {
  const me = myId();
  if (!me) return { error: 'Not signed in' };
  if (me === otherId) return { error: "You can't friend yourself" };
  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: me, addressee_id: otherId, status: 'pending' });
  if (error) {
    // 23505 = pair already exists (race / already requested).
    if (error.code === '23505') return {};
    return { error: 'Could not send request. Try again.' };
  }
  return {};
}

/** Accept an incoming request (I'm the addressee). */
export async function acceptFriendRequest(otherId: string): Promise<{ error?: string }> {
  const me = myId();
  if (!me) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('requester_id', otherId)
    .eq('addressee_id', me)
    .eq('status', 'pending');
  if (error) return { error: 'Could not accept request. Try again.' };
  return {};
}

/** Decline an incoming request, cancel a sent one, or unfriend — all delete the pair row. */
export async function removeFriendship(otherId: string): Promise<{ error?: string }> {
  const me = myId();
  if (!me) return { error: 'Not signed in' };
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(pairFilter(me, otherId));
  if (error) return { error: 'Could not update. Try again.' };
  return {};
}

/** Accepted friends, as the other-party profiles. */
export async function listFriends(): Promise<FriendProfile[]> {
  const me = myId();
  if (!me) return [];
  const { data } = await supabase
    .from('friendships')
    .select(
      'requester_id, addressee_id, requester:users!friendships_requester_id_fkey(id, display_name, avatar_url), addressee:users!friendships_addressee_id_fkey(id, display_name, avatar_url)'
    )
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  return (data ?? [])
    .map((r: any) => (r.requester_id === me ? r.addressee : r.requester))
    .filter(Boolean) as FriendProfile[];
}

/** Incoming pending requests (people who asked to friend me), with their profiles. */
export async function listIncomingRequests(): Promise<FriendProfile[]> {
  const me = myId();
  if (!me) return [];
  const { data } = await supabase
    .from('friendships')
    .select('requester:users!friendships_requester_id_fkey(id, display_name, avatar_url)')
    .eq('status', 'pending')
    .eq('addressee_id', me);
  return (data ?? []).map((r: any) => r.requester).filter(Boolean) as FriendProfile[];
}

/** Outgoing pending requests (people I asked), with their profiles. */
export async function listOutgoingRequests(): Promise<FriendProfile[]> {
  const me = myId();
  if (!me) return [];
  const { data } = await supabase
    .from('friendships')
    .select('addressee:users!friendships_addressee_id_fkey(id, display_name, avatar_url)')
    .eq('status', 'pending')
    .eq('requester_id', me);
  return (data ?? []).map((r: any) => r.addressee).filter(Boolean) as FriendProfile[];
}

/** Count of accepted friends. */
export async function countFriends(): Promise<number> {
  const me = myId();
  if (!me) return 0;
  const { count } = await supabase
    .from('friendships')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  return count ?? 0;
}
