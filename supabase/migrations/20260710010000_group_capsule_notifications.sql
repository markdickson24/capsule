-- GROUPS.md #6 — auto-join is standing consent, so a group capsule (manual
-- or cron-created) should notify members with a real "new capsule" card
-- instead of a fake pending "invite" (they're already joined; there's
-- nothing to accept). Adds a dedicated `group_capsule` notification type and
-- teaches notify_on_invite to emit it instead of piggybacking on 'invite'.

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule'
  ]));

-- notify_on_invite fires on every capsule_members insert. Previously it only
-- handled the pending-invite case (role != owner, joined_at null). Group
-- capsule members are inserted already-joined (joined_at set at insert time,
-- both by CreateScreen's manual group-capsule path and the
-- create-group-capsules cron) — the original function silently skipped them,
-- so group members got no notification at all. The new branch fires exactly
-- once per non-owner joined member of a capsule that has a group_id; the
-- original pending-invite branch is untouched, so the two can never
-- double-fire for the same row (joined_at is either null or not).
create or replace function public.notify_on_invite()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_group_id uuid;
  v_owner_id uuid;
begin
  if new.role != 'owner' and new.joined_at is null then
    insert into public.notifications (user_id, capsule_id, type, sent_at)
    values (new.user_id, new.capsule_id, 'invite', now());
  elsif new.role != 'owner' and new.joined_at is not null then
    select group_id, owner_id into v_group_id, v_owner_id
      from public.capsules where id = new.capsule_id;

    if v_group_id is not null then
      -- pushed_at stamped here: the caller (CreateScreen or the cron) sends
      -- the Expo push in the same request, so there's no separate batching
      -- cron for this type to pick up later (mirrors unlock_reminder).
      insert into public.notifications (user_id, capsule_id, actor_id, type, sent_at, pushed_at)
      values (new.user_id, new.capsule_id, v_owner_id, 'group_capsule', now(), now());
    end if;
  end if;
  return new;
end;
$function$;
