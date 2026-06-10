-- Fix avatar uploads broken by 20260515232248_security_hardening.sql.
--
-- That migration dropped "Anyone can read avatars" — the only SELECT policy on
-- storage.objects for the avatars bucket — to stop clients enumerating the
-- bucket. But a Supabase Storage upload reads the object row back after
-- inserting it, so the INSERT also needs a matching SELECT policy. With none,
-- every avatar upsert fails with 403 "new row violates row-level security
-- policy", even though the INSERT WITH CHECK (auth.uid() = foldername[1]) is
-- satisfied. (capsule-media uploads were unaffected because that bucket kept
-- its SELECT policies.)
--
-- Re-add SELECT, but owner-scoped: a user can read only their OWN avatar row
-- (path's first folder == auth.uid()). This restores uploads without
-- reintroducing broad enumeration of every user's avatar objects. Public avatar
-- *images* keep loading via the public CDN endpoint, which does not consult this
-- policy.

create policy "Users can read their own avatar"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (select auth.uid())::text = (storage.foldername(name))[1]
);
