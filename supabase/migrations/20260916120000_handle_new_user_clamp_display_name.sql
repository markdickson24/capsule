-- 20260802120200_security_constraints added users_display_name_length_check
-- (char_length(display_name) <= 30). handle_new_user() derives display_name
-- from raw_user_meta_data->>'display_name' or, failing that, the email's
-- local part — neither is bounded (local parts can be 64 chars). A value over
-- 30 would raise 23514 inside this AFTER INSERT trigger on auth.users, rolling
-- back the auth user itself: sign-up fails outright with "Database error
-- saving new user". Clamp to the constraint here. Same-signature
-- `create or replace`, so the function ACL is preserved.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.users (id, email, phone, display_name, auth_provider)
  values (
    new.id,
    new.email,
    new.phone,
    left(coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.phone, 'user'), '@', 1)), 30),
    coalesce(new.raw_user_meta_data->>'provider', 'email')
  );
  return new;
end;
$function$;
