-- Add caption to media items (150-char limit, uploader-only edits)
alter table media
  add column caption text check (char_length(caption) <= 150);

-- Allow uploaders to update their own media's caption
create policy "Uploaders can update their own media"
  on media for update
  using (uploader_id = (select auth.uid()))
  with check (uploader_id = (select auth.uid()));
