---
name: update-claude-md
description: Use after adding or significantly changing a feature, subsystem, schema, RLS policy, edge function, or cross-cutting convention in the Capsule codebase. Ensures CLAUDE.md is updated to reflect the change so it stays the source of truth for future sessions. Invoke whenever a "big feature" lands or an architectural decision is made.
---

# Keep CLAUDE.md current

CLAUDE.md is the project's single source of architectural truth. Future sessions
start cold and rely on it. Whenever a meaningful change lands, update CLAUDE.md in
the **same change** — never leave it stale.

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

1. Find the **existing section** the change belongs to (Storage, Database Schema,
   RLS Constraints, a screen's "Key Patterns", etc.) and edit it in place. Only add
   a new section/heading when the topic genuinely doesn't fit anywhere.
2. Keep the existing voice: terse, imperative, decision-and-reason. Document the
   *why* and the *gotcha*, not a play-by-play of what you did.
3. If you added a table/column/trigger/policy, reflect it in the schema table and
   the Triggers/RLS lists — keep `src/types/database.ts` and the schema docs in sync.
4. If you added a reusable helper, name it and its file path so future code reuses
   it instead of reinventing it.
5. Don't turn CLAUDE.md into a changelog. It describes the system as it is now —
   prune anything the change made obsolete.

## Verify before finishing

Before considering the feature done, confirm CLAUDE.md mentions the new
file/table/convention. If a teammate read only CLAUDE.md, would they know this
exists and how to use it correctly? If not, the update isn't complete.
