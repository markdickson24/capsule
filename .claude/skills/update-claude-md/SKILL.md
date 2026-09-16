---
name: update-claude-md
description: Use after adding or significantly changing a feature, subsystem, schema, RLS policy, edge function, or cross-cutting convention in the Capsule codebase. Ensures the project docs (root CLAUDE.md + .claude/rules/*.md) are updated to reflect the change so they stay the source of truth for future sessions. Invoke whenever a "big feature" lands or an architectural decision is made.
---

# Keep the project docs current

Project knowledge is split in two:

- **`CLAUDE.md` (root)** loads in every session. It holds only commands, the stack,
  the rule-file index, and one-line cross-cutting rules. Keep it under ~200 lines.
- **`.claude/rules/<topic>.md`** holds subsystem detail. Each file has `paths:`
  frontmatter and loads automatically when Claude reads a matching file. This is
  what lets the user skip naming the relevant docs in a prompt, so the `paths`
  must stay accurate.

Future sessions start cold and rely on these files. Whenever a meaningful change
lands, update them in the **same change**. Never leave them stale.

## When this applies

Update the docs when you:
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

## Where to write

1. **Find the rule file** whose topic fits (see the index table in root
   `CLAUDE.md`) and edit the existing section in place.
2. **Check its `paths:` frontmatter.** If the code you touched (a new file, a new
   screen, a new edge function) isn't matched by any glob in that file, add a glob
   for it. Otherwise the doc won't load when someone next edits that code.
3. **Genuinely new subsystem?** Create `.claude/rules/<topic>.md` with `paths:`
   frontmatter covering its files, and add a row to the index table in root
   `CLAUDE.md`.
4. **Root `CLAUDE.md`**: only touch it for commands, the index, or a rule that
   applies across the whole codebase (one line, pointing at the rule file with
   the detail). If a rule bites in code outside its own area, add a one-liner
   under "Cross-cutting rules".
5. Rules without `paths:` load every session, so don't create them unless the
   content truly belongs in root.

## How to write

- Keep the existing voice: terse, imperative, decision-and-reason. Document the
  *why* and the *gotcha*, not a play-by-play of what you did.
- If you added a table/column/trigger/policy, reflect it in the schema table and
  Triggers/RLS lists in `database-and-rls.md`. Keep `src/types/database.ts` in sync.
- If you added a reusable helper, name it and its file path so future code reuses
  it instead of reinventing it.
- Don't write a changelog. Describe the system as it is now, and prune anything
  the change made obsolete.
- Long incident backstory can go in an `<!-- HTML comment -->`. Those are stripped
  before loading, so they cost no context.

## Verify before finishing

- Confirm the relevant rule file mentions the new file/table/convention, and
  that its `paths:` match the files you touched.
- Root `CLAUDE.md` is still under ~200 lines.
- If a teammate read only the docs that auto-load for the files they're editing,
  would they know this exists and how to use it correctly? If not, the update
  isn't complete.
