-- Harden set_default_superlatives against a null auth.uid() short-circuiting
-- the owner check via 3-valued NULL logic (v_owner <> NULL evaluates to NULL,
-- which `IF` treats as false, silently skipping the authorization check).
-- Caught immediately after applying 20260701153405_default_awards.sql by
-- testing the RPC in a session with no JWT (auth.uid() null) — the owner
-- check silently passed and inserted a row with suggested_by = null,
-- violating the not-null constraint only by luck. Adds an explicit
-- "not authenticated" guard and switches to `is distinct from` so the
-- comparison is null-safe either way.
create or replace function public.set_default_superlatives(
  p_capsule_id uuid,
  p_awards     jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_owner  uuid;
  v_status text;
  v_count  integer;
  v_award  record;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select owner_id, status into v_owner, v_status
    from public.capsules
   where id = p_capsule_id;

  if v_owner is null then
    raise exception 'Capsule not found';
  end if;

  if v_owner is distinct from v_uid then
    raise exception 'Only the capsule owner can set default awards';
  end if;

  if v_status = 'unlocked' then
    raise exception 'Cannot change default awards after unlock';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_awards);
  if v_count > 4 then
    raise exception 'At most 4 default awards are allowed';
  end if;

  delete from public.superlative_categories
   where capsule_id = p_capsule_id
     and is_default;

  for v_award in
    select * from jsonb_to_recordset(p_awards) as x(label text, target_type text)
  loop
    if char_length(trim(v_award.label)) < 3 or char_length(trim(v_award.label)) > 80 then
      raise exception 'Award label must be 3-80 characters';
    end if;
    if v_award.target_type not in ('person', 'media') then
      raise exception 'Invalid target_type';
    end if;

    insert into public.superlative_categories
      (capsule_id, suggested_by, label, target_type, status, is_default, promoted_at)
    values
      (p_capsule_id, v_uid, trim(v_award.label), v_award.target_type, 'live', true, now());
  end loop;
end;
$$;
