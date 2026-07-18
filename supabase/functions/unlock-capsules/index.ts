import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');
let lastCallTime = 0;
const RATE_LIMIT_MS = 55_000;

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
};

// Phrase the time-to-unlock from the actual remaining ms, so the copy is correct
// regardless of exactly which minute the reminder fired.
function formatRemaining(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min >= 20 * 60) return 'tomorrow';
  if (min >= 90) return `in about ${Math.round(min / 60)} hours`;
  if (min >= 45) return 'in about an hour';
  if (min >= 2) return `in ${min} minutes`;
  return 'in moments';
}

// Expo's push API rejects a request carrying more than 100 messages — beyond
// that the WHOLE batch fails, which for a 100+ member capsule unlocking would
// silently drop every push for that tick. Slice into ≤100-message requests
// (sequential, to stay friendly with Expo's rate limits).
async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

async function pushTokensFor(capsuleId: string): Promise<{ tokens: string[]; userIds: string[] }> {
  const { data: members } = await supabase
    .from('capsule_members')
    .select('user_id, users(push_token)')
    .eq('capsule_id', capsuleId)
    .not('joined_at', 'is', null);

  const userIds: string[] = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
  const tokens: string[] = (members ?? [])
    .map((m: any) => m.users?.push_token)
    .filter(Boolean);
  return { tokens, userIds };
}

// Reminder tiers, in firing order. `ms` is how far before unlock_at the tier covers.
const REMINDER_TIERS: { col: string; ms: number }[] = [
  { col: 'unlock_reminder_1d_sent_at', ms: 24 * 60 * 60 * 1000 },
  { col: 'unlock_reminder_1h_sent_at', ms: 60 * 60 * 1000 },
  { col: 'unlock_reminder_10m_sent_at', ms: 10 * 60 * 1000 },
];

async function dispatchReminders(messages: ExpoMessage[]): Promise<number> {
  let reminded = 0;
  for (const tier of REMINDER_TIERS) {
    const nowIso = new Date().toISOString();
    const cutoff = new Date(Date.now() + tier.ms).toISOString();

    // Atomically stamp + return the capsules that just entered this tier's window.
    // `.is(col, null)` makes it idempotent: only unstamped rows are claimed, so a
    // tier can never double-send even if two ticks overlap.
    const { data: due, error } = await supabase
      .from('capsules')
      .update({ [tier.col]: nowIso })
      .eq('status', 'active')
      .eq('unlock_mode', 'time')
      .is(tier.col, null)
      .gt('unlock_at', nowIso)
      .lte('unlock_at', cutoff)
      .select('id, title, unlock_at');

    if (error || !due?.length) continue;

    for (const capsule of due) {
      const remaining = new Date(capsule.unlock_at).getTime() - Date.now();
      const phrase = formatRemaining(remaining);
      const { tokens, userIds } = await pushTokensFor(capsule.id);

      // Durable in-app rows (pushed_at set — we push inline below). The tier
      // stamp already committed, so a failed insert is unrecoverable — at
      // least make it visible in the function logs instead of silent.
      if (userIds.length) {
        const { error: reminderInsertError } = await supabase.from('notifications').insert(
          userIds.map((uid) => ({
            user_id: uid,
            capsule_id: capsule.id,
            type: 'unlock_reminder',
            pushed_at: nowIso,
          }))
        );
        if (reminderInsertError) {
          console.error(`Failed to insert unlock_reminder rows for capsule ${capsule.id}:`, reminderInsertError);
        }
      }

      for (const token of tokens) {
        messages.push({
          to: token,
          title: '⏳ Capsule unlocking soon',
          body: `"${capsule.title}" unlocks ${phrase}.`,
          data: { capsuleId: capsule.id },
          sound: 'default',
        });
      }
      reminded += tokens.length;
    }
  }
  return reminded;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const now = Date.now();
  if (now - lastCallTime < RATE_LIMIT_MS) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
  }
  lastCallTime = now;

  const messages: ExpoMessage[] = [];

  // 1) Unlock any capsules whose time has come, and notify members.
  const { data: unlocked, error } = await supabase
    .from('capsules')
    .update({ status: 'unlocked' })
    .eq('status', 'active')
    .eq('unlock_mode', 'time')
    .lte('unlock_at', new Date().toISOString())
    .select('id, title');

  if (error) {
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }

  for (const capsule of unlocked ?? []) {
    const { tokens, userIds } = await pushTokensFor(capsule.id);
    const nowIso = new Date().toISOString();

    // Durable in-app rows FIRST, to every joined member (not just those with a
    // push token) — this is the fallback if the push below fails or the member
    // never granted notification permission.
    if (userIds.length) {
      const { error: notifyError } = await supabase.from('notifications').insert(
        userIds.map((uid) => ({
          user_id: uid,
          capsule_id: capsule.id,
          type: 'unlock',
          pushed_at: nowIso,
        }))
      );
      if (notifyError) {
        console.error(`Failed to insert unlock notifications for capsule ${capsule.id}:`, notifyError);
      }
    }

    for (const token of tokens) {
      messages.push({
        to: token,
        title: '🔓 Your capsule just opened!',
        body: `"${capsule.title}" is unlocked — see what's inside and vote on awards.`,
        data: { capsuleId: capsule.id },
        sound: 'default',
      });
    }
  }

  // 2) Countdown reminders (1d / 1h / 10m before unlock). Isolated so a failure
  //    here can never block the unlock path above.
  let reminded = 0;
  try {
    reminded = await dispatchReminders(messages);
  } catch (_e) {
    // swallow — reminders are best-effort
  }

  if (messages.length) {
    // The durable notification rows above are already written — a push failure
    // here (transient Expo/network error) must not fail the whole invocation or
    // block subsequent ticks; the in-app Alerts card is the fallback.
    try {
      await sendExpoPush(messages);
    } catch (e) {
      console.error('sendExpoPush failed:', e);
    }
  }

  return new Response(
    JSON.stringify({ unlocked: unlocked?.length ?? 0, reminded, notified: messages.length })
  );
});
