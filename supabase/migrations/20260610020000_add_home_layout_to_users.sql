-- Per-user Home screen layout preference ('list' = comfortable cards (default),
-- 'grid' = 2-column compact). Synced like accent_color via ThemeContext.
alter table public.users
  add column if not exists home_layout text not null default 'list'
  check (home_layout in ('list', 'grid'));
