# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!--
Maintainers: this root file is loaded in EVERY session, so keep it under ~200 lines.
Feature/subsystem detail lives in .claude/rules/*.md. Each rule file has `paths:` frontmatter
and loads automatically the moment Claude reads a matching file, so nobody has to name it in a prompt.
When adding docs: put them in the rule file whose paths cover the code you changed (or add a new
rule file + an index row below). Only put a line here if it applies across the whole codebase.
-->

## Commands

```bash
npx expo start --web        # Run in browser (primary dev target)
npx expo start --ios        # Run on iOS simulator
npx expo start --android    # Run on Android emulator
```

```bash
npm run test:lib          # Tier 0: every src/lib/*.test.ts under npx tsx, one process per file, first failure exits 1 (bare node:assert scripts, ~10s; three boot a throwaway local Postgres)
npm run test:components   # Tier 1: jest (jest-expo/ios + @testing-library/react-native 14, async API); testMatch is src/**/__tests__/**/*.test.@(ts|tsx) only
npm test                  # test:lib && test:components, sequential — a broken lib test fails before the jest cold start
npm run typecheck         # tsc --noEmit for the RN app. supabase/functions is excluded in tsconfig.json (Deno code, typechecked by Deno not tsc). Baseline is 42 pre-existing errors, not 0: 36 un-hoisted @expo/vector-icons TS2307 imports + 6 in netlify/edge-functions/join.ts. A change is clean if it adds none.
```

No linter is configured.

Test conventions (see `audits/BUG_HUNT_2026-09-14.md` § Harness for the full picture):
- **Prefer Tier 0.** When a bug is traced to logic inside a screen or component, extract the decision into a pure function in `src/lib/<name>.ts`, import it back, and add assertions to `src/lib/<name>.test.ts` in the existing bare style: top-level `import assert from 'node:assert/strict'`, straight-line assertions with a comment naming the real-world case each pins down, closing `console.log('<name>: all assertions passed')`. No `describe`/`it`. `test:lib` picks it up with no registration. Worked examples: `zoomMath.ts`, `galleryLayout.ts`, `mergeCapsuleUpdate.ts`.
- **SQL (RLS / trigger / RPC) fixes** get a Tier 0 test that boots a throwaway local Postgres and loads the real migration SQL by text extraction — copy `src/lib/capsulesUpdateColumnGrants.test.ts` or `src/lib/tombstoneTriggerCascadeDelete.test.ts`. These require `initdb` on PATH or at `/Library/PostgreSQL/18/bin`.
- **Tier 1 only for genuine rendering/interaction bugs.** Tests live in `src/**/__tests__/*.test.tsx`, render through `test/renderWithProviders.tsx`, and mock `../../../lib/supabase` per file with a `mock`-prefixed chainable builder. Config: `jest.config.js`, `babel.config.js` (mandatory), `test/setup.ts`. A real screen test costs ~5s cold.
- Harness status: `jest.config.js`, `babel.config.js`, `test/` and the package.json scripts + devDependencies are committed (`4707ef9`), so a clean clone can run all of the above after `npm ci`. Tier 0's Postgres-backed tests still need `initdb` locally.

## Architecture

**Capsule** is a time-locked photo-sharing app. Users create albums that stay locked until a set date, then unlock for all invited members simultaneously.

### Stack
- **React Native + Expo ~54** (single codebase for iOS, Android, web)
- **Supabase** — auth, PostgreSQL, storage, RLS, realtime
- **React Navigation v7** — native stack + custom bottom tabs
- **expo-image** — cached image loading with native disk/memory cache
- **expo-haptics** — tactile feedback on calendar and UI interactions
- **expo-location** — foreground GPS for proximity check-in (native only)
- **expo-share-intent** — iOS Share Extension + Android intent filter for receiving photos/videos from other apps
- **TypeScript** ~5.9

## How project knowledge is organized

Detailed subsystem docs live in `.claude/rules/`. They load **automatically** when you read a file matching a rule's `paths:` frontmatter, so they're usually already in context by the time you edit.

**Before planning or answering questions about an area whose code you haven't opened yet, read the matching rule file(s) from the index below.** Many tasks touch several areas (for example, a new Pro-gated upload flow touches `monetization`, `uploads-and-preview`, and `database-and-rls`), so read every one that applies. The rule files are the source of truth for their topic. If one of them contradicts this file, trust the rule file and fix the conflict.

| Rule file (`.claude/rules/…`) | Covers |
|---|---|
| `project-structure.md` | Annotated map of every directory and key module |
| `auth-and-session.md` | Auth flow, PKCE, SecureStore, sign-up OTP, web session gotchas |
| `navigation-and-deep-links.md` | Navigator tree, route params, CreateScreen layout, capsule:// deep links, QR join, join edge function |
| `database-and-rls.md` | RLS constraints, schema table, column grants, triggers, indexes, permission model |
| `storage-and-media-urls.md` | Storage buckets, upload headers, fresh tokens, avatar paths, image render API quota |
| `camera.md` | In-app camera gestures, flip-while-recording, dual camera native module |
| `uploads-and-preview.md` | PreviewScreen, share intent, background upload queue, resize pipeline |
| `capsule-detail.md` | CapsuleDetailScreen internals: rings, viewer zoom, members sheet, realtime unlock, media grid |
| `ui-conventions.md` | Layout/keyboard gotchas, design tokens, a11y, expo-image, animations, skeletons, retry prompt, ConfirmModal, DatePicker |
| `theme-settings-profile.md` | Accent color/gradients, onAccentColor contrast, Settings, ColorPicker, Profile |
| `capsule-lifecycle.md` | Owner-only actions, archive, delete, unlock cron, instant unlock, proximity, surprise mode, start date |
| `onboarding-and-tour.md` | Onboarding wizard steps and the new-user coach-mark tour |
| `awards.md` | Superlatives lifecycle, voting RLS, finalize cron, default awards |
| `groups.md` | Groups, recurrence anchors, group capsule cron, ownership transfer on account delete |
| `social-and-moderation.md` | Report/block, demo-account search filter, friends |
| `notifications-and-push.md` | Push registration, invite push authz, Expo chunking, contribution nudges |
| `live-activity.md` | iOS Live Activity countdown: data model, native target, reconcile loop, limitations |
| `monetization.md` | RevenueCat client/webhook, tier limits, Pro gates, export, App Store IAP setup |
| `shared-libs.md` | uuid, haptics, toast, limitSheet, sessionStore, Sentry, cache + useCachedFetch, module-level state on sign-out |
| `build-and-release.md` | Native patches, env vars, server secrets, reviewer credential, EAS/TestFlight |

## Cross-cutting rules (apply everywhere)

Each of these is explained in the linked rule file. They're repeated here because they bite in code that doesn't obviously belong to that area.

**Client code**
- Read the session with `sessionStore.get()`, not `supabase.auth.getSession()` (hangs on web). For native upload bearer tokens use `getFreshAccessToken()` / `getFreshSession()`. → `auth-and-session`, `storage-and-media-urls`
- Never `Alert.alert` for confirm/cancel (no-ops on web). Use `<ConfirmModal>`. Never `KeyboardAvoidingView` (broken under New Arch on iOS). Track keyboard height manually. → `ui-conventions`
- Never hardcode `#FF6B35` in app screens (use `useTheme().accentColor`) or `'#fff'` on accent surfaces (use `onAccentColor`). → `theme-settings-profile`
- Any user-initiated mutation that fails must `toast.show(...)`. Any swallowed error must `reportError(err, { where })`, with no PII. → `shared-libs`
- Use `expo-image`, `SafeAreaView` from `react-native-safe-area-context`, `haptics` from `src/lib/haptics.ts`, `randomUUID()` from `src/lib/uuid.ts` (never `Math.random`). → `ui-conventions`, `shared-libs`
- Never use the global `URL` class to parse `capsule://` links (RN polyfill is http-only). → `navigation-and-deep-links`
- Module-level state must be bound to a user id and cleared on sign-out. → `shared-libs`
- A client gate reading the current user's own `isPro` must not fire while `entitlementsLoading`. Tier limits live only in `src/lib/tierLimits.ts`. Caps key off the capsule **owner's** tier. → `monetization`
- Never `select('*')`, `email`, `phone`, or `push_token` from `users`. → `database-and-rls`

**Database / Supabase**
- The live DB is the source of truth when it disagrees with a migration. Verify with `pg_policies` / `pg_get_functiondef` before changing behavior. `supabase-schema.sql` has drifted, so the migrations win. → `database-and-rls`
- A membership test always means `joined_at is not null`. → `capsule-lifecycle`
- New client-readable/writable columns on `users`, `capsule_members`, or `media` need explicit column-level `grant select/update (col)` in the same migration. → `database-and-rls`
- A signature-changing `DROP` + `CREATE` of a function resets its ACL. Re-grant to every role that actually needs it, including `anon` where applicable. Never revoke EXECUTE on a function an RLS policy calls. → `database-and-rls`
- Never delete from `storage.objects` in SQL. Use the Storage API. → `capsule-lifecycle`
- Cron edge functions authenticate with `requireCronSecret` (fails closed). Never publish a secret comparison through a `public`-schema RPC. → `capsule-lifecycle`
- Push senders chunk to ≤100 messages. User-authored text goes in the body, never the title. → `notifications-and-push`
- No destructive SQL against production without explicit approval.

**Secrets**
- The App Store reviewer credential must never be committed. `EXPO_PUBLIC_REVENUECAT_IOS_KEY` has no fallback key. → `build-and-release`
