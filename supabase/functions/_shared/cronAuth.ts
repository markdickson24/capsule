// Constant-time string compare — avoids leaking the secret via response timing.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * Shared Bearer-token auth for cron-triggered edge functions.
 *
 * FAILS CLOSED: if CRON_SECRET is unset, every request is rejected (500,
 * "Server misconfigured") rather than silently accepting all requests. The
 * previous per-function pattern (`if (CRON_SECRET && auth !== ...)`) was
 * fail-OPEN — an unset secret made the `&&` short-circuit false, so the
 * check never ran and the function (deployed with verify_jwt=false) became
 * a fully public, unauthenticated endpoint. See the 2026-07-29 security
 * audit. Mirrors revenuecat-webhook/index.ts's timingSafeEqual pattern.
 *
 * Returns a Response to short-circuit the caller's Deno.serve handler on,
 * or null when the request is authorized.
 */
export function requireCronSecret(req: Request): Response | null {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret) {
    console.error('CRON_SECRET is not set — refusing all requests');
    return new Response('Server misconfigured', { status: 500 });
  }
  const auth = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}
