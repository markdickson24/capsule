-- Instant unlock: let a member's own client flip a due capsule to 'unlocked'
-- instead of waiting up to 60s for the per-minute cron.
--
-- The cron stays exactly as it is for capsules nobody is looking at. This just
-- removes the wait for the person actually watching the countdown hit zero,
-- which was the single largest component of perceived unlock latency (0-60s,
-- dwarfing the ~2 round-trips and the image downloads combined).

-- ---------------------------------------------------------------------------
-- 1. Decouple the unlock push from *who* performed the flip.
-- ---------------------------------------------------------------------------
-- unlock-capsules currently derives its push list from the rows its own
-- `update ... where status='active'` returns. Once a client can win that race,
-- that update matches zero rows and NOBODY gets the unlock push — including
-- every member who wasn't on the screen, i.e. exactly the people the push
-- exists for. Same shape as contribution_start_notified_at: a dedupe stamp
-- that the notifier claims independently of the state change.
alter table public.capsules
  add column if not exists unlock_notified_at timestamptz;

comment on column public.capsules.unlock_notified_at is
  'Set once the unlock push has been dispatched. Independent of who flipped '
  'status (cron or claim_capsule_unlock), so the push fires exactly once '
  'either way. Null on an unlocked capsule = push still owed.';

-- Backfill every already-unlocked capsule as "already notified". Without this
-- the next cron tick would treat the entire history of unlocked capsules as
-- owing a push and blast "your capsule unlocked!" for capsules that opened
-- weeks ago.
update public.capsules
   set unlock_notified_at = coalesce(unlocked_at, now())
 where status = 'unlocked'
   and unlock_notified_at is null;

create index if not exists idx_capsules_unlock_push_due
  on public.capsules (unlock_at)
  where status = 'unlocked' and unlock_mode = 'time' and unlock_notified_at is null;

-- ---------------------------------------------------------------------------
-- 2. The client-callable claim.
-- ---------------------------------------------------------------------------
-- security definer because the capsules UPDATE policy is owner-only, but ANY
-- joined member watching the countdown should be able to trigger the flip —
-- same reasoning as check_in() for proximity unlocks.
create or replace function public.claim_capsule_unlock(p_capsule_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Caller must be a JOINED member. A pending invitee has not consented into
  -- the capsule and must not be able to drive its state.
  if not exists (
    select 1 from capsule_members
     where capsule_id = p_capsule_id
       and user_id = v_uid
       and joined_at is not null
  ) then
    raise exception 'Not a member of this capsule';
  end if;

  -- The guard that makes this safe to expose: the row only moves when the
  -- capsule is genuinely due. A client cannot unlock anything early by
  -- calling this — now() is the server's clock, not the device's.
  --
  -- unlock_mode = 'time' ONLY. A 'both' capsule additionally requires everyone
  -- to be physically together, which is check_in()'s job; flipping it on the
  -- date alone would skip that half of the contract entirely.
  update capsules
     set status = 'unlocked'
   where id = p_capsule_id
     and status = 'active'
     and unlock_mode = 'time'
     and unlock_at <= now()
  returning status into v_status;

  -- No row moved: either someone (cron or another member's device) already
  -- unlocked it, or it isn't due. Report the real current status rather than
  -- raising — a lost race is the normal case here, not an error.
  if v_status is null then
    select status into v_status from capsules where id = p_capsule_id;
  end if;

  return v_status;
end;
$$;

-- The capsules_stamp_unlock_meta BEFORE UPDATE trigger fires on this flip like
-- any other, so unlocked_at and superlative_voting_closes_at are stamped for
-- free — voting windows behave identically whichever path unlocked it.

revoke execute on function public.claim_capsule_unlock(uuid) from public, anon;
grant execute on function public.claim_capsule_unlock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Widen the cron's EXISTS gate.
-- ---------------------------------------------------------------------------
-- The gate (PERFORMANCE.md #4) only fires the edge function when an 'active'
-- capsule is within 24h of unlocking. A capsule that a CLIENT just unlocked is
-- no longer 'active', so under the old gate the function would never be
-- invoked for it and its push would never be sent — the exact regression
-- step 1 exists to prevent, reintroduced one layer up. Add the owed-push
-- condition so a client-flipped capsule still pulls the notifier in.
--
-- Re-registering a cron command is unschedule + schedule (CLAUDE.md).
select cron.unschedule('unlock-capsules');
select cron.schedule(
  'unlock-capsules',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://ezxxvvmesegegkdeniri.supabase.co/functions/v1/unlock-capsules',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'cron_unlock_capsules_secret'
        )
      ),
      body := '{}'::jsonb
    )
    where exists (
      select 1 from public.capsules
      where status = 'active' and unlock_mode = 'time'
        and unlock_at <= now() + interval '24 hours'
    ) or exists (
      select 1 from public.capsules
      where status = 'unlocked' and unlock_mode = 'time'
        and unlock_notified_at is null
    );
  $cron$
);
