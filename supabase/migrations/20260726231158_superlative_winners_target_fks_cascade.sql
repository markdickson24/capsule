-- superlative_winners has the same XOR check as superlative_votes:
--   CHECK ((target_user_id IS NOT NULL)::int + (target_media_id IS NOT NULL)::int = 1)
-- but its two target FKs were ON DELETE SET NULL while superlative_votes' are
-- ON DELETE CASCADE. SET NULL is unsatisfiable against that check: nulling
-- either column makes the sum 0, so the constraint raises 23514 and aborts the
-- whole transaction.
--
-- Deleting a capsule cascades to media, which triggered exactly this:
--
--   ERROR 23514: new row for relation "superlative_winners" violates check
--   constraint "superlative_winners_check"
--   CONTEXT: UPDATE ONLY "superlative_winners" SET "target_media_id" = NULL
--            SQL statement "delete from public.capsules where id = p_capsule_id"
--
-- So any capsule holding a finalized MEDIA-target winner could not be deleted.
-- That is specific to UNLOCKED capsules — winners only exist after
-- finalize_capsule_superlatives, which only runs post-unlock. Reported as
-- "not being allowed to delete my unlocked capsule".
--
-- target_user_id has the same defect on the account-deletion path: deleting a
-- user who won a PERSON-target award nulls that column and raises the same
-- violation, so delete_my_account would fail for anyone who had ever won one.
--
-- A winner row whose target no longer exists is meaningless, so CASCADE is also
-- the semantically correct rule — matching superlative_votes, which already had it.

alter table public.superlative_winners
  drop constraint superlative_winners_target_media_id_fkey,
  add  constraint superlative_winners_target_media_id_fkey
       foreign key (target_media_id) references public.media(id) on delete cascade;

alter table public.superlative_winners
  drop constraint superlative_winners_target_user_id_fkey,
  add  constraint superlative_winners_target_user_id_fkey
       foreign key (target_user_id) references public.users(id) on delete cascade;
