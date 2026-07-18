import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CRON_SECRET = Deno.env.get('CRON_SECRET');

// Daily moderation digest (launch plan / APP_STORE_REVIEW.md #13): pushes an
// Expo notification to the admin account whenever content_reports has pending
// rows, so reports get acted on within Guideline 1.2's expectations instead
// of sitting unseen. Triggered by the `report-digest` cron (daily, EXISTS-
// gated on pending reports — see 20260718121000_report_digest.sql). The admin
// user id comes from Vault via the service-role-only get_report_digest_admin()
// RPC; rotate it with vault.update_secret, no redeploy needed.
Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: pending, error } = await supabase
    .from('content_reports')
    .select('id, target_type, reason, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('pending reports fetch failed:', error.message);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return new Response(JSON.stringify({ pending: 0, pushed: false }));
  }

  const { data: adminId, error: adminErr } = await supabase.rpc('get_report_digest_admin');
  if (adminErr || !adminId) {
    console.error('admin id lookup failed:', adminErr?.message ?? 'no vault secret');
    return new Response(JSON.stringify({ pending: pending.length, pushed: false }), { status: 500 });
  }

  const { data: admin } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', adminId)
    .single();
  if (!admin?.push_token) {
    console.error(`admin ${adminId} has no push token — digest undeliverable`);
    return new Response(JSON.stringify({ pending: pending.length, pushed: false }));
  }

  const oldestDays = Math.floor(
    (Date.now() - new Date(pending[0].created_at).getTime()) / 86_400_000
  );
  const byReason = new Map<string, number>();
  for (const r of pending) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  const breakdown = [...byReason.entries()].map(([k, v]) => `${v} ${k}`).join(', ');

  const reportWord = pending.length === 1 ? 'report' : 'reports';
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify([
      {
        to: admin.push_token,
        title: `🛡️ ${pending.length} content ${reportWord} pending`,
        body: `${breakdown} — oldest is ${oldestDays}d old. Review in the Supabase dashboard (content_reports).`,
        data: {},
        sound: 'default',
      },
    ]),
  });

  return new Response(JSON.stringify({ pending: pending.length, pushed: true }));
});
