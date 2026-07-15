import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
const TIERS = ['7d', '3d', '1d'] as const;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

// Phrase the deadline from the actual remaining ms, so the copy is correct
// regardless of exactly which minute the tier fired (mirrors unlock-capsules'
// formatRemaining).
function formatDeadline(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return 'tomorrow';
  return `in ${days} days`;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const messages: ExpoMessage[] = [];
  let reminded = 0;

  for (const tier of TIERS) {
    const { data: claimed, error } = await supabase.rpc('claim_contribution_nudge_tier', { p_tier: tier });
    if (error || !claimed?.length) continue;

    // Group claimed members by capsule so top_contributors is fetched once
    // per capsule, not once per member.
    const byCapsule = new Map<string, { capsuleTitle: string; effectiveDeadline: string; userIds: string[] }>();
    for (const row of claimed as any[]) {
      const entry = byCapsule.get(row.capsule_id) ?? {
        capsuleTitle: row.capsule_title,
        effectiveDeadline: row.effective_deadline,
        userIds: [],
      };
      entry.userIds.push(row.user_id);
      byCapsule.set(row.capsule_id, entry);
    }

    for (const [capsuleId, entry] of byCapsule) {
      const { data: topContributors } = await supabase.rpc('top_contributors', { p_capsule_id: capsuleId });
      const deadlinePhrase = formatDeadline(entry.effectiveDeadline);

      const { data: userRows } = await supabase
        .from('users')
        .select('id, push_token')
        .in('id', entry.userIds);
      const pushTokenById = new Map((userRows ?? []).map((u: any) => [u.id, u.push_token]));

      // Never compare a recipient against a top contributor they've blocked.
      const { data: blockedByRows } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .in('blocker_id', entry.userIds);
      const blockedByRecipient = new Map<string, Set<string>>();
      for (const b of (blockedByRows ?? []) as any[]) {
        if (!blockedByRecipient.has(b.blocker_id)) blockedByRecipient.set(b.blocker_id, new Set());
        blockedByRecipient.get(b.blocker_id)!.add(b.blocked_id);
      }

      const rows: any[] = [];
      for (const userId of entry.userIds) {
        const blockedIds = blockedByRecipient.get(userId) ?? new Set<string>();
        const top = (topContributors ?? []).find((c: any) => !blockedIds.has(c.user_id));

        let title: string;
        let body: string;
        if (top) {
          const topPhotoWord = top.photo_count === 1 ? 'photo' : 'photos';
          title = "⏰ Don't be left out";
          body = `${top.display_name} added ${top.photo_count} ${topPhotoWord} to "${entry.capsuleTitle}" — you haven't added any yet. Locks ${deadlinePhrase}.`;
        } else {
          title = '⏰ Add your photos';
          body = `Nobody's added photos to "${entry.capsuleTitle}" yet — don't be the one holding it up! Locks ${deadlinePhrase}.`;
        }

        rows.push({
          user_id: userId,
          capsule_id: capsuleId,
          actor_id: top?.user_id ?? null,
          type: 'contribution_nudge',
          count: top?.photo_count ?? null,
          pushed_at: new Date().toISOString(),
        });

        const token = pushTokenById.get(userId);
        if (token) {
          messages.push({ to: token, title, body, data: { capsuleId }, sound: 'default' });
        }
      }
      await supabase.from('notifications').insert(rows);
      reminded += rows.length;
    }
  }

  if (messages.length) {
    await sendExpoPush(messages);
  }

  return new Response(JSON.stringify({ reminded }));
});
