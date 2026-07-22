-- Premium palettes: Pro users can set a 2-color gradient accent. Stored as
-- "#hexA,#hexB" (null = solid accent, the default for everyone). Additive and
-- non-destructive. Column-level grant is REQUIRED — a new users column gets no
-- SELECT grant by default (table grant was revoked), which 403s the whole
-- select(). Gating that only Pro may set this is client-side (cosmetic, not a
-- security boundary); no trigger needed.
alter table public.users add column if not exists accent_gradient text;

grant select (accent_gradient) on public.users to authenticated;
grant update (accent_gradient) on public.users to authenticated;
