<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Email/Password Authentication (F-01)

- **Plan**: `context/changes/email-password-auth/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-07
- **Verdict**: REVISE → **SOUND** after triage (7 findings fixed 2026-09-08; 5 convention findings fixed 2026-09-09)
- **Findings**: 2 critical, 4 warnings, 1 observation (round 1) + 1 critical, 2 warnings, 2 observations (round 2, CLAUDE.md conventions)

## Verdicts

| Dimension | Round 1 (2026-09-07) | Round 2 (2026-09-09, CLAUDE.md conventions) |
|-----------|----------------------|---------------------------------------------|
| End-State Alignment | FAIL | unchanged |
| Lean Execution | PASS | unchanged |
| Architectural Fitness | PASS | **FAIL** (N1, N5) |
| Blind Spots | FAIL | unchanged |
| Plan Completeness | WARNING | WARNING (N2, N4) |

Rubric arithmetic says RETHINK on 2 FAILs; overridden to REVISE — neither FAIL
implicates the approach. The architecture is sound and every fix is a targeted
edit, not a redesign. All findings from both rounds are now resolved in the plan
(N3 dismissed by user with the rationale recorded in the plan itself).

## Grounding

5/5 modified paths ✓ (`package.json`, `supabase/config.toml`, `.env.example`,
`src/utils/supabase/proxy.ts`, `src/app/layout.tsx`), 8/8 new paths correctly
absent ✓, 10/10 symbols ✓, all line citations verified (`proxy.ts:33-41`,
`middleware.ts:26`, `config.toml` enable_confirmations / minimum_password_length
/ rate limits, `tech-stack.md:9` stale `vercel`), blast radius clean
(`updateSession` has exactly one importer: `src/middleware.ts:2`), brief↔plan ✓.

Progress section is mechanically clean: one `## Progress` at the bottom, all five
phase headings match their body counterparts verbatim, all 37 success-criteria
bullets have matching `N.M` entries, no stray checkboxes in phase blocks.
Re-checked after triage: 41 criteria bullets, 41 matching checkboxes, still clean.

## Findings

### F1 — "Real Workers deploy" is verified only on local workerd

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 5 — success criteria 5.4–5.8; Desired End State
- **Detail**: Desired End State promises the session survives "a real Cloudflare Workers deploy", and Current State Analysis quotes `infrastructure.md:92` — "smoke-test auth/session on a deployed preview, not just local" — calling it "a hard verification requirement". Every Phase 5 criterion then runs against `pnpm preview`, which `package.json:11` defines as `opennextjs-cloudflare build && opennextjs-cloudflare preview` — wrangler running workerd on localhost. All of 5.4–5.8 can pass while the promised capability is unverified. This matters concretely: `proxy.ts:4-8` names the worst failure mode in this codebase — "without this, Cloudflare could cache a Set-Cookie and sign users in as each other" — and Cloudflare's edge cache does not exist in local workerd. `roadmap.md:63` notes Cloudflare's Git integration already builds PR previews, so the mechanism the risk register asks for is available and unused.
- **Fix**: Add a Phase 5 criterion running the sign-up / sign-in / refresh / sign-out loop against a deployed Cloudflare PR preview URL, checking response headers on an authenticated page for `cf-cache-status` plus correct `Cache-Control: private` on Set-Cookie responses. Keep the local `pnpm preview` run as the fast pre-check.
- **Decision**: FIXED — Phase 5 now separates local `pnpm preview` from the deployed Cloudflare PR preview; criteria 5.10 and 5.11 added (full loop on the deployed preview; `Cache-Control: private` / no `cf-cache-status: HIT` on authenticated responses).

### F2 — Hosted Supabase settings are listed as migration notes but are Phase 2 prerequisites

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 (item 4 + manual verification); Migration Notes
- **Detail**: The plan documents the constraint and then sequences around it. Current State Analysis says `config.toml` "configures the *local* stack only. The hosted project's dashboard settings are separate and must be aligned by hand." Migration Notes lists those two steps as post-change work. But `.env.example:8-16` establishes that `pnpm dev` loads `.env` = the HOSTED project; only `pnpm dev:local` uses the local stack — and the Testing Strategy script says `pnpm dev`. So Phase 2's manual criteria run against hosted Supabase, where confirmations default to ON: 2.4 ("creates an account and redirects, no confirmation required") fails because signUp returns a user with no session, and 2.5 ("shows the specific already-registered message") fails because Supabase obfuscates duplicate signup when confirmations are on — as the plan itself explains under Critical Implementation Details. An implementer working top-to-bottom hits two failing criteria and has every reason to hunt for a code bug that isn't there.
- **Fix**: Promote both dashboard settings to an explicit "Phase 2 Prerequisites" block with a verification step (sign up on the hosted project, confirm a session cookie is set, before writing the forms), and cross-reference it from Migration Notes rather than the reverse.
- **Decision**: FIXED — Phase 2 opens with a Prerequisites block explaining the hosted/local split and why it gates 2.4/2.5; criterion 2.9 added; Migration Notes now cross-references the phase instead of owning the steps.

### F3 — Auth header doubles auth-server round trips; Performance Considerations says the opposite

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 item 2; Performance Considerations
- **Detail**: Performance Considerations reasons only about Phase 4: "route protection adds a pathname comparison and nothing else — no new network round trip." True. But Phase 3 mounts `auth-status.tsx` in the root layout and specifies it calls `createClient()` then `auth.getUser()`. `getUser()` is not a local cookie decode — it revalidates the JWT against Supabase's `/auth/v1/user` endpoint. Combined with the existing call at `proxy.ts:37`, every page render costs two sequential auth-server round trips from a Workers isolate, on the critical render path of every route. The plan never states this cost.
- **Fix A ⭐ Recommended**: Keep `getUser()` in the header; correct Performance Considerations to name the second round trip and accept it explicitly.
  - Strength: Correctness first — `getUser` is the only call Supabase guarantees is authenticated in a Server Component, and this matches the pattern already used in `src/app/api/health/route.ts:11`.
  - Tradeoff: ~50–200ms added to every page render, until someone revisits it.
  - Confidence: HIGH — the call site and its semantics are both verified in this repo.
  - Blind spot: Actual added latency from a Workers isolate to the hosted Supabase region is unmeasured.
- **Fix B**: Use `getClaims()` in the header for local JWT verification instead of a network call.
  - Strength: Removes the second round trip entirely while staying authenticated (asymmetric-key local verification).
  - Tradeoff: Requires the hosted project to be on JWT signing keys; adds a second auth-reading pattern in a change whose point is establishing one.
  - Confidence: MEDIUM — supported by `@supabase/supabase-js ^2.110.0`, but this project's key configuration is unverified.
  - Blind spot: Whether the linked hosted project has migrated to signing keys at all.
- **Decision**: FIXED via Fix A — Performance Considerations now names the second `getUser()` round trip, accepts it for correctness, and records `getClaims()` as the escape hatch.

### F4 — `emailRedirectTo` origin is unspecified, and Server Actions have no request object

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 5 item 2
- **Detail**: The contract reads "`signUp` passes `options.emailRedirectTo` built from the request origin". There is no request object in a Server Action. The origin must come from `await headers()` (Host + x-forwarded-proto) or from configuration — and `.env.example` defines no site-URL variable, while Phase 5 item 3 edits `.env.example` without adding one. The implementer has to invent this, and the obvious invention (raw `Host` header) makes the emailed confirmation link host-controlled. Supabase's redirect allowlist blunts the consequence but does not remove the class of problem, and this is the one file in the change whose purpose is a security-relevant external link.
- **Fix A ⭐ Recommended**: Add `NEXT_PUBLIC_SITE_URL` to `.env.example` (local, preview, production values documented) and build `emailRedirectTo` from it.
  - Strength: Deterministic, not attacker-influenced; Phase 5 item 3 already opens `.env.example`, so this costs one extra block in a file the phase edits anyway.
  - Tradeoff: One more env var per environment — a wrong value silently breaks a dormant flow.
  - Confidence: HIGH — `.env.example` already documents a per-environment env-file layout this slots into.
  - Blind spot: Cloudflare preview URLs are per-deployment, so the preview value can't be a single static string.
- **Fix B**: Derive from `await headers()` and validate the host against a small allowlist before use.
  - Strength: Works automatically across per-deployment preview URLs with no env var to maintain.
  - Tradeoff: The allowlist is the same maintenance burden in a different form, plus async header plumbing in the action.
  - Confidence: MEDIUM — behavior of forwarded headers under the OpenNext adapter on Workers is unverified here.
  - Blind spot: Which proto/host headers workerd actually populates.
- **Decision**: FIXED via Fix A — Phase 5 item 2 builds `emailRedirectTo` from `NEXT_PUBLIC_SITE_URL` with the Host-header alternative explicitly rejected; item 3 adds the variable and records the per-deployment preview-URL gap.

### F5 — Phase 5's local confirmation test (5.9) has no runway

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — criterion 5.9; Phase 5 item 3
- **Detail**: "With confirmations temporarily enabled on the local stack, a signup email's link lands on `/auth/confirm`" — nothing in the plan explains how to get there. Three blockers: (1) the manual script uses `pnpm dev`, which is the HOSTED project (`.env.example:8-16`); the local stack needs `pnpm dev:local`, a script the plan never mentions. (2) Reading the email requires the local stack's mail catcher (Mailpit/Inbucket, :54324), never named. (3) `config.toml:163` has `additional_redirect_urls = ["https://127.0.0.1:3000"]` — note **https**, and `127.0.0.1` rather than `localhost`; Supabase matches redirect URLs exactly, so a link back to `http://localhost:3000/auth/confirm` is rejected even after Phase 5's edit.
- **Fix**: Rewrite 5.9 as explicit steps — `supabase start`, flip `enable_confirmations = true`, `pnpm dev:local`, read mail at localhost:54324 — and have Phase 5 item 3 fix the scheme/host of `additional_redirect_urls` rather than only appending a path.
- **Decision**: FIXED — criterion 5.9 rewritten as five concrete steps (`supabase start` → flip `enable_confirmations` → `pnpm dev:local` → mail catcher at :54324 → revert); item 3 now corrects the scheme/host of `additional_redirect_urls` rather than only appending a path.

### F6 — Fail-closed allowlist sends non-page requests an HTML login redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 item 4; Phase 4 item 1
- **Detail**: `middleware.ts:26` matches everything except `_next/static`, `_next/image`, `favicon.ico`, and image extensions, and `isPublicRoute` allowlists exactly one path under `/api`. Under the new policy every other non-page request gets a 307 to `/login` with an HTML body: future `app/api/` routes (CLAUDE.md reserves that directory for "webhooks, external clients" — a webhook receives a login page instead of 401 JSON, and a 307 preserves the method so it re-POSTs to `/login`); `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `opengraph-image` if added; and a form submitted after the session expires on a protected page. The plan applied exactly this forward-looking reasoning to `/lists` and to signed-out 404s, but stopped at page routes.
- **Fix**: In the Phase 4 branch, return `401 JSON` for pathnames starting with `/api/` instead of a redirect, and note in `routes.ts` that well-known files need allowlisting when added.
- **Decision**: FIXED — Phase 4 item 1 gains a 401-JSON branch for `/api/` paths (with the 307 method-preservation rationale); criterion 4.9 added; `routes.ts` gains a comment covering well-known files.

### F7 — Phase 4 item 2 is a no-op against Phase 2's contract

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 item 1 vs. Phase 4 item 2
- **Detail**: Phase 2 already specifies "Both read an optional `next` field from the FormData and pass it through `safeReturnTo` for the success redirect." Phase 4 item 2 then says the success redirect "becomes `safeReturnTo(formData.get("next"))`". Either Phase 2 did it and Phase 4 has nothing to do, or Phase 2 hardcoded and contradicts its own contract. An implementer can't tell which.
- **Fix**: Reword Phase 4 item 2 as a verification step ("confirm the Phase 2 wiring, now that a producer exists") rather than a change, or drop it and fold the check into criterion 4.4.
- **Decision**: FIXED — Phase 4 item 2 retitled 'verification only, no code change expected' and reworded to check the Phase 2 wiring.

## Notes (not findings)

- The Phase 4 cookie-copy snippet is correct, and better than Supabase's own documented example, which omits the copy on the redirect branch. It matters for a case the plan didn't spell out: when `getUser()` fails on an expired refresh token, `setAll` fires to *clear* cookies, and dropping those clears leaves stale credentials retrying a failing refresh on every subsequent request.
- Lean Execution and Architectural Fitness are genuine passes — the scope discipline (F-02/F-03 boundaries, pure Edge-safe modules, no test-runner land-grab) is the strongest part of this plan.

---

## Round 2 — 2026-09-09 (re-review after CLAUDE.md §Code structure convention)

Triggered by new coding conventions added at `CLAUDE.md:48-54`: feature-based
architecture, child components under `./{parent}/components/{name}/`, shared
components in `src/components/`, an `index.ts` barrel per component directory,
and unit tests co-located with their subject. Re-scored dimensions:
Architectural Fitness PASS → **FAIL**, Plan Completeness **WARNING**; the other
three unchanged.

### N1 — Components placed in `src/components/` are not shared

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 item 3; Phase 3 item 2
- **Detail**: The plan put `sign-in-form`, `sign-up-form` and `auth-status` in `src/components/auth/`, which the new convention reserves for shared components. Each has exactly one consumer, so all three are child components. The forms are the template S-01 and S-04 will copy, so a wrong location propagates.
- **Decision**: FIXED — forms moved to `src/app/(auth)/{login,signup}/components/{sign-in,sign-up}-form/`; `auth-status` moved to `src/app/components/auth-status/` (user chose the literal child rule over treating root-layout chrome as shared). `src/components/` stays empty in this change.

### N2 — No index barrels specified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phases 2–3
- **Detail**: The convention requires every component directory to expose an `index.ts` re-exporting its contents; the plan named bare `.tsx` files with no barrels.
- **Decision**: FIXED — each component directory now specifies an `index.ts`, and consumers import through the directory rather than the file. Criteria 2.10 and 3.8 added.

### N3 — `src/app/actions/auth.ts` buckets by technical role

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 item 1
- **Detail**: "Feature based as much as possible" argues against an `actions/` directory that will accumulate `events.ts`, `items.ts`, `claims.ts` as a technical hierarchy parallel to the feature one. Alternative considered: `src/lib/auth/actions.ts`.
- **Decision**: DISMISSED by user — location kept. `signOut` is consumed by the header outside the `(auth)` group, and the Next-conventional location is where a reader looks first. Recorded in the plan as a deliberate, revisitable exception rather than an oversight.

### N4 — Test location now constrained for F-02

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Testing Strategy
- **Detail**: The plan promises F-02 can test the pure modules "with no refactor", but the convention now fixes where those tests go. F-02 is a parallel change and would otherwise pick its own convention.
- **Decision**: FIXED — Testing Strategy records that tests co-locate with their subject (`redirect.test.ts` beside `redirect.ts`), not in `__tests__/` or a top-level `tests/` tree.

### N5 — Barrel rule vs. Edge-runtime purity

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details — Edge-runtime purity
- **Detail**: The barrel rule is scoped to component directories, so `src/lib/auth/` is exempt — but over-applying it there would let middleware importing `isPublicRoute` through a barrel drag zod (via `schemas.ts`) into the Edge bundle.
- **Decision**: FIXED — the Edge-purity section now states explicitly that `src/lib/auth/` gets no `index.ts` and middleware must import exact module paths.
