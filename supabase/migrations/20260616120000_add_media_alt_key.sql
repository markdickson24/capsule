-- Dual (PiP) photos store two pre-rendered composites so the viewer can swap which
-- lens is the main frame (BeReal-style). storage_key holds the default (back-main)
-- composite; alt_storage_key holds the swapped (front-main) one. A non-null
-- alt_storage_key marks the media item as a swappable dual photo.
alter table public.media
  add column if not exists alt_storage_key text;
