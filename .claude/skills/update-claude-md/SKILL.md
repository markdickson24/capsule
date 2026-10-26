---
name: update-claude-md
description: Use after adding or significantly changing a feature, subsystem, schema, RLS policy, edge function, or cross-cutting convention in the Capsule codebase. Ensures CLAUDE.md and docs/architecture/ are updated to reflect the change so they stay the source of truth for future sessions. Invoke whenever a "big feature" lands or an architectural decision is made.
---

# Keep CLAUDE.md and the architecture docs current

The project's architectural truth is split in two:
- `CLAUDE.md` — a short core loaded into every session: commands, stack, the
  docs index, and the **Rules** list of cross-cutting always/never rules.
- `docs/architecture/*.md` — the detailed per-subsystem notes, read on demand.

Future sessions start cold and rely on both. Whenever a meaningful change lands,
update them in the **same change** — never leave them stale. Keep CLAUDE.md
short: detail belongs in the docs.

## When this applies

Update CLAUDE.md when you:
- Add a new feature, screen, component, hook, or lib module
- Add or change a Supabase table, column, trigger, RPC, RLS policy, or edge function
- Add or change a cron job, storage bucket, or storage policy
- Introduce a new cross-cutting convention, gotcha, or "always do X / never do Y" rule
- Change navigation structure, route params, or the auth/session flow
- Discover and fix a non-obvious bug whose root cause is worth recording so it
  isn't reintroduced (add it to the relevant gotchas section, not a changelog)

Skip it for trivial changes: typo fixes, pure refactors with no behavioral or
structural change, dependency bumps, and one-off debugging that leaves no lasting
rule.

## How to update

1. Find the doc and **existing section** the change belongs to (the index table in
   CLAUDE.md maps topics to `docs/architecture/*.md`) and edit it in place. Only add
   a new section, or a new doc plus an index row, when the topic genuinely doesn't
   fit anywhere.
   Add a one-line entry to CLAUDE.md's **Rules** only for a new cross-cutting
   always/never rule, linking the doc that explains it.
2. Keep the existing voice: terse, imperative, decision-and-reason. Document the
   *why* and the *gotcha*, not a play-by-play of what you did.
3. If you added a table/column/trigger/policy, reflect it in the schema table and
   the Triggers/RLS lists — keep `src/types/database.ts` and the schema docs in sync.
4. If you added a reusable helper, name it and its file path so future code reuses
   it instead of reinventing it.
5. Don't turn either file into a changelog. It describes the system as it is now —
   prune anything the change made obsolete.

## Verify before finishing

Before considering the feature done, confirm the relevant doc mentions the new
file/table/convention, and that CLAUDE.md's index or Rules would lead a cold
session to it. If not, the update isn't complete.
