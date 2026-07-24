-- New accounts default to the brand reddish-coral (#FC6A5B — the website
-- --accent) instead of the classic orange (#FF6B35). New `users` rows inherit
-- accent_color from this column default (handle_new_user doesn't set it
-- explicitly). Existing users are untouched — nothing rewrites their color;
-- they keep whatever they had (grandfathered, same as every other accent change).
alter table public.users alter column accent_color set default '#FC6A5B';
