-- The friend notification functions are trigger functions (RETURNS trigger) and
-- must never be REST-callable. Revoke the default EXECUTE grants so they don't
-- show up under /rest/v1/rpc and the security advisor stays clean.
revoke execute on function public.notify_on_friend_request() from public, anon, authenticated;
revoke execute on function public.notify_on_friend_accept() from public, anon, authenticated;
