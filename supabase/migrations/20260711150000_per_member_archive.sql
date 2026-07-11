-- Per-member archive: archiving is a personal "hide from my feed" action, not
-- a capsule-global one.
--
-- Previously (20260706120000_member_archive_capsule.sql) set_capsule_archived
-- let ANY joined member stamp capsules.archived_at — one member archiving
-- silently removed the capsule from EVERY member's Home feed into the
-- collapsed Archived section, which users experienced as "capsules keep
-- disappearing" (confirmed in production: every capsules.archived_at value
-- dated on/after 2026-07-06, the day that migration shipped).
--
-- archived_at now lives on the caller's own capsule_members row. The RPC keeps
-- its name and signature so existing clients don't break; it just stamps the
-- caller's member row instead of the capsule.

alter table public.capsule_members add column if not exists archived_at timestamptz;

-- Preserve what everyone currently sees: existing global archives become
-- per-member archives for every joined member of those capsules.
update public.capsule_members cm
   set archived_at = c.archived_at
  from public.capsules c
 where c.id = cm.capsule_id
   and c.archived_at is not null
   and cm.joined_at is not null;

-- capsules.archived_at is retired: nothing in the new client reads or writes
-- it. The column and its current values are kept frozen so old installed
-- builds (which still filter Home on it) keep seeing what they saw.

create or replace function public.set_capsule_archived(p_capsule_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.capsule_members
     set archived_at = case when p_archived then now() else null end
   where capsule_id = p_capsule_id
     and user_id = v_uid
     and joined_at is not null;

  if not found then
    raise exception 'Not a member of this capsule';
  end if;
end;
$$;
