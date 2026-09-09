# Email/Password Authentication (F-01) — Plan Brief

> Full plan: `context/changes/email-password-auth/plan.md`

## What & Why

Wire the user-facing email/password authentication surface — sign-up, sign-in, sign-out — onto the Supabase SSR scaffold that already exists in this repo, and add fail-closed route protection with a safe return path. This is roadmap **F-01**, a bounded foundation whose justification is entirely downstream: S-01 (create event), S-03 (claim an item — the north star), S-04 (edit items), and S-05 (post-event reveal) are all authenticated writes and cannot begin without a session the app can obtain, display, and terminate.

## Starting Point

The session plumbing is already built and proven: `src/utils/supabase/{client,server,proxy}.ts` are wired, middleware refreshes the auth token on every non-asset request, and `/api/health` smoke-tests the cookie path under `workerd`. What is entirely missing is the surface — no auth routes, no Server Actions, no forms, no header, no sign-out affordance, and no route protection (`src/utils/supabase/proxy.ts:36` records this explicitly). There is also no validation library, no `typecheck` script, and no test runner.

## Desired End State

A visitor creates an account with email and password and is signed in immediately, with no confirmation email. Their email and a working sign-out button appear in the app header on every page, and the session survives refresh, direct URL entry, and a real Cloudflare Workers deploy. Any unauthenticated request outside a named public allowlist lands on `/login?next=<original-path>` and returns to that path after signing in. A `/auth/confirm` route exists and is correct but dormant.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Email confirmation | Off for v1, but the confirm route built anyway | Hosted Supabase SMTP is capped at ~2 emails/hour, making confirmed sign-up impractical to test — but shipping the route makes v2 a config flip, not a code change. |
| Route protection | Middleware redirect, public-allowlist policy (protect everything else) | Fails closed, so a new authenticated route can never be accidentally left open; the cost is that FR-007's shared-list route must be allowlisted before S-02 ships. |
| Where protection lives | Inside `updateSession`, after the existing `getUser()` | That call already runs on every matched request, so protection costs zero additional round trips and the user object is in hand exactly where the decision is made. |
| Extra scope | `returnTo` redirect + minimal auth header only | S-03 sends a guest to sign-in mid-claim and must return them to the list; the header is the only place sign-out (FR-002) can be clicked. |
| Validation | zod + `useActionState` | The pattern the bundled Next 16 auth guide prescribes; establishes one `FormState` error shape that S-01 and S-04 forms reuse instead of each inventing one. |
| Sign-out | Server Action + form button | Clears cookies server-side in the same place middleware reads them, avoiding the client/server desync the `proxy.ts` comments warn about; works without JavaScript. |
| Error copy | Generic on sign-in, specific on sign-up | Blocks credential-stuffing feedback where it matters, while giving a returning user the one signal they need — important because v1 has no password reset. |
| Verification | Manual + lint/typecheck/build; no test runner | F-02 owns introducing a runner and the two changes are parallel, so both installing one would collide; every testable unit here is written as a pure function so F-02 can test it with no refactor. |

## Scope

**In scope:** sign-up, sign-in, sign-out; zod schemas and a shared `FormState`; a safe `returnTo` validator; a public-route allowlist; middleware protection; a minimal auth header; a dormant `/auth/confirm` route; verification on a real Workers preview.

**Out of scope:** OAuth; password reset; active email confirmation; a dashboard (FR-014); email change / account deletion / profile fields; any database schema (F-02 owns it); a test runner (F-02 owns it); design tokens (F-03 owns them); rate limiting beyond Supabase's built-in per-IP limits.

## Architecture / Approach

Built inward-out. `src/lib/auth/` holds three pure, dependency-free modules — `schemas.ts` (zod + `FormState`), `redirect.ts` (`safeReturnTo`), `routes.ts` (`isPublicRoute`) — two of which are imported by Edge-runtime middleware and so must stay free of Node built-ins (and which therefore get no barrel `index.ts`, so middleware can't pull zod into the Edge bundle). `src/app/actions/auth.ts` holds the three Server Actions; `src/app/(auth)/{login,signup}/page.tsx` render Client Component forms bound via `useActionState`. `src/utils/supabase/proxy.ts` gains the protection branch immediately after its existing `getUser()` call. `src/app/layout.tsx` mounts a server-rendered auth header.

Component placement follows `CLAUDE.md` §Code structure convention: each component gets its own directory with an `index.ts` barrel, nested beside the parent that consumes it — `src/app/(auth)/login/components/sign-in-form/`, `src/app/(auth)/signup/components/sign-up-form/`, `src/app/components/auth-status/`. Nothing here has more than one consumer, so `src/components/` stays empty in this change.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Auth primitives | zod, `typecheck` script, schemas, `safeReturnTo`, `isPublicRoute` | The forward-declared `/lists` allowlist entry is a guess about a route S-01 hasn't built yet |
| 2. Sign-up & sign-in | Server Actions, `(auth)` pages, forms, error copy policy | Sign-up's specific "already registered" copy only works while confirmations are off |
| 3. Auth header & sign-out | Server-rendered header, `signOut` action, mounted in layout | Opts every route out of static rendering (acceptable — nothing is cached today) |
| 4. Route protection | Allowlist redirect in `updateSession` with `next` param | A redirect response silently drops the rotated auth cookies unless they're copied — the likeliest way to break sessions |
| 5. Confirm path & Workers verify | `/auth/confirm` handler, `emailRedirectTo`, preview smoke test | Edge middleware could behave differently under the OpenNext adapter than in `next dev` |

**Prerequisites:** none in code — the Supabase SSR scaffold and Workers deploy path are already in place. Two manual hosted-dashboard settings are required (confirmations disabled, minimum password length 8); a hosted Supabase project and working `pnpm preview` deploy are needed for Phase 5.

**Estimated effort:** ~2–3 sessions across 5 phases; Phases 1–3 are mostly mechanical, Phase 4 carries the real risk, Phase 5 is verification-heavy.

## Open Risks & Assumptions

- **The `/lists` allowlist entry is a forward declaration.** S-01 must adopt that URL prefix for the shared list or update `src/lib/auth/routes.ts` — otherwise unauthenticated guests get bounced to `/login`, breaking FR-007 and the north-star flow in a way that looks like a routing bug.
- **No password reset means a forgotten password is a dead account** in v1. Accepted, but it is the most likely early support burden.
- **Enabling confirmations in v2 is not a pure config flip after all** — it also requires reverting the sign-up error copy to generic, because Supabase obfuscates existing-user signup once confirmations are on. Recorded as a comment in the confirm route.
- **Under a fail-closed allowlist, signed-out 404s become login redirects.** Expected behavior, not a bug, but it will look odd the first time someone mistypes a URL.
- ~~**`context/foundation/tech-stack.md:9` is stale**~~ — **resolved 2026-09-08.** It said `deployment_target: vercel` (and `ci_provider: github-actions`) while the repo deploys to Cloudflare Workers via OpenNext with no GitHub Actions. Both hints and the "Why this stack" paragraph are corrected; `CLAUDE.md` was updated to match. This plan continues to treat `wrangler.jsonc` as authoritative.

## Success Criteria (Summary)

- A new user can go from never having visited the app to holding a live session in one form submission, and can end that session from any page.
- An unauthenticated visitor sent to a protected path arrives back at that exact path after signing in, and can never be redirected off-site by a crafted `next` parameter.
- The entire flow behaves identically on a real Cloudflare Workers preview as it does in `next dev` — the specific verification the infra risk register demands.
