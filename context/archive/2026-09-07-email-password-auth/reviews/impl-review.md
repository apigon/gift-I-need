<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Email/Password Authentication (F-01)

- **Plan**: context/changes/email-password-auth/plan.md
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success criteria evidence

- `pnpm typecheck` — pass (exit 0)
- `pnpm lint` — pass (exit 0)
- `pnpm build` — pass; all routes dynamic (ƒ), as the plan expected
- `opennextjs-cloudflare build` + `preview` — pass. curl smoke under workerd: `/api/health` 200 `{"ok":true,"authenticated":false}`; `GET /anything?x=1` → 307 `/login?next=%2Fanything%3Fx%3D1`; `/api/nope` → 401 `{"error":"unauthorized"}`; `/login` 200 with `Cache-Control: private, no-store`; `POST /anything` → **307** (see F1)
- Manual: all items `[x]`. 5.5–5.8, 5.10 and 5.11 have no sha. They are deploy/runtime checks with no diff to point to, so this is acceptable and not a sign of rubber-stamping.

## Findings

### F1 — Page POSTs still get a 307 replay to /login

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/utils/supabase/proxy.ts:89 (comment at :67-71)
- **Detail**: Only `/api/*` gets the 401 branch. Every other unauthenticated request gets `NextResponse.redirect`, which is a 307 and preserves the method. Server Actions POST to the *page* path, so a Server Action sent from a protected page after the session expires is replayed as a POST against `/login`. That is the exact case plan.md:320 names, and it violates lesson "`NextResponse.redirect` is 307 and preserves the method". The comment at :67-71 says this case is handled. It isn't. Confirmed under workerd: `curl -X POST /anything` → `307 Location: /login?next=%2Fanything`. It's latent until S-01 adds the first protected page with a form.
- **Fix**: For non-GET/HEAD requests, redirect with status 303 (`NextResponse.redirect(url, 303)`). Keep 307 for GET. Correct the comment.
  - Strength: Directly applies the recorded lesson; a one-line change with the cookie copy unchanged.
  - Tradeoff: A Server Action `fetch` that follows a 303 gets HTML back instead of an RSC payload, so the client may show an error rather than navigating to the login page.
  - Confidence: MED — the 303 downgrade is standard, but how Next 16's action client handles a middleware redirect is unverified.
  - Blind spot: Haven't tested with a real `Next-Action` request. The alternative, 401 when the `Next-Action` header is present, may give a cleaner client error.
- **Decision**: FIXED — 303 for non-GET/HEAD page requests, 307 kept for GET/HEAD, comment corrected. Verified under workerd: GET/HEAD → 307, POST /anything → 303, POST /api/nope → 401.

### F2 — Plan body not updated for deviations

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/email-password-auth/plan.md:197-212, :264-273, :382-386
- **Detail**: `git diff main...HEAD -- plan.md` shows only the Progress checkboxes changing. Four justified deviations are recorded only in commit messages, CLAUDE.md or lessons.md:
  - (a) the confirm route uses PKCE `?code=`/`exchangeCodeForSession` first; the plan says `token_hash`/`verifyOtp`, which never fires under @supabase/ssr;
  - (b) there is one `components/index.ts` barrel, not one per component directory;
  - (c) `additional_redirect_urls` uses `/**` wildcards, not the exact `/auth/confirm` entry;
  - (d) unplanned `isAuthEntryRoute`: signed-in users on /login or /signup are bounced away (proxy.ts:98-105).

  Anyone copying the plan as a template would rebuild the broken confirm handler.
- **Fix**: Add a "Deviations" addendum to plan.md that lists (a)–(d) with links to their commits.
- **Decision**: FIXED — Deviations addendum added to plan.md before ## Progress (items 1–5, including the F1 fix).

### F3 — signUp ignores data.session

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/auth.ts:112
- **Detail**: Only `{ error }` is destructured. Lesson "Supabase auth methods return errors; they do not throw" names this exact case: with confirmations on, `signUp` returns `data.session === null` and no error. The user is then redirected to `next`, bounced back to /login by the proxy, and never told to check their email. It's latent while confirmations are off. The "enable confirmations" checklist in confirm/route.ts:14-31 doesn't mention it.
- **Fix**: Destructure `data`, and when `!data.session`, return a form-level "Check your email to confirm your account" state instead of redirecting.
- **Decision**: ACCEPTED-AS-RULE: signUp has three outcomes, not two (code left unfixed — latent while confirmations are off)

### F4 — setAll drops @supabase/ssr cache headers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/utils/supabase/proxy.ts:42 (comment :26-30)
- **Detail**: @supabase/ssr 0.12 passes a second `headers` argument to `setAll` (`Cache-Control: private, no-cache, no-store…`, cookies.js:426). The proxy's `setAll` ignores it, yet the comment at :28-30 says those headers "take effect". Pages are still safe: dynamic rendering sends no-store, and 5.11 verified this on the deployed preview. The proxy's own 307/401 responses can carry `Set-Cookie` without no-store. The comment at :26 also says the entry point is "the root `proxy.ts`" when it is actually `src/middleware.ts`.
- **Fix**: Accept `(cookiesToSet, headers)` in `setAll`, apply `headers` to `supabaseResponse`, copy them in `copyCookies`, and fix both comments.
- **Decision**: FIXED — setAll applies the ssr headers to supabaseResponse; copyCookies carries Cache-Control/Expires/Pragma onto redirect/401 responses; both comments corrected. typecheck, lint, Workers build pass (no signed-in runtime check — rotation not reproducible via curl).

### F5 — signOut ignores its error result

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/auth.ts:158
- **Detail**: `await supabase.auth.signOut()` discards `{ error }`. On a network error or 5xx, auth-js returns the error without clearing the local session, so the user is redirected to `/` still signed in and given no feedback.
- **Fix**: Use `signOut({ scope: "local" })` so the cookies are always cleared, or check `error` and log it.
- **Decision**: SKIPPED

### F6 — safeReturnTo accepts dot-segment paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth/redirect.ts:37
- **Detail**: `/.//evil` and `/..//evil` get past the `//` prefix check and normalise to the path `//evil` on the same origin. They stay same-origin, and Next's `normalizeRepeatedSlashes` cleans them up, so this is not exploitable today. The guard relies on prefix string checks instead of parsing.
- **Fix**: Defence in depth: parse with `new URL(next, "http://x")`, require `origin === "http://x"`, and return the normalised `pathname + search + hash`.
- **Decision**: FIXED — safeReturnTo now parses with new URL() against a placeholder origin and rejects a changed origin or a normalised pathname starting with `//`; returns pathname+search+hash. typecheck, lint, Workers build pass. Runtime probe of the new function NOT run (command denied) — verify /.//evil, /%2e%2e//evil → `/` when F-02 adds a runner.

### F7 — Page gate has two implicit public paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth/routes.ts:30; src/middleware.ts:26
- **Detail**: (a) The whole `/auth/` subtree is public, so any future `/auth/*` route becomes reachable without sign-in without anyone deciding that. (b) The middleware matcher skips any path ending in an image extension, so a protected dynamic route requested as `/x/abc.png` skips the gate. RLS is still the data boundary, and routes.ts:10-15 documents well-known files but not either of these.
- **Fix**: Allowlist the exact path `/auth/confirm`, and add a comment in routes.ts about the matcher's image-extension exclusion.
- **Decision**: FIXED — `/auth/confirm` moved to PUBLIC_EXACT_PATHS (the `/auth/` prefix removed); matcher image-extension gap documented in routes.ts; plan.md Deviations item 6 added. Verified under workerd: /auth/confirm reaches its handler, /auth/other → 307 /login?next=…, /lists/abc stays public.

### F8 — getUser errors discarded silently

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/utils/supabase/proxy.ts:59; src/app/api/health/route.ts:11-15
- **Detail**: The proxy fails closed, which is correct, but logs nothing, so a Supabase outage looks like a mass sign-out. `/api/health` still reports `ok: true` when Supabase is unreachable. That is the anti-pattern the lessons register cites; it is now documented in a comment rather than fixed.
- **Fix**: `console.error` on `getUser` errors other than "session missing", and have health return 503 in that case.
- **Decision**: FIXED (differently) — keyed on `isAuthRetryableFetchError` (network failure / 5xx) rather than "anything but session-missing", so stale JWTs are not treated as outages. Proxy logs outages (still fails closed); /api/health returns 503 on outage. Verified under workerd: signed-out /api/health → 200 ok:true, 0 proxy log lines; 503 path not reproducible locally.

### F9 — Unplanned repo-level edits on the branch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: README.md, context/foundation/prd.md, CLAUDE.md, eslint.config.mjs, supabase/config.toml `[analytics]`, src/app/api/health/route.ts
- **Detail**: None of these were in Changes Required:
  - a full local-dev README guide;
  - PRD FR-015/016;
  - the CLAUDE.md branching/PR convention (498fc2e);
  - an eslint ignore for `.wrangler/**`;
  - analytics disabled for colima;
  - the health route no longer leaking raw errors.

  All are benign, and several are necessary (lint, security). They widen the PR's review surface.
- **Fix**: List them in the F2 Deviations addendum. No code change.
- **Decision**: FIXED — listed under "Unplanned changes on the branch" in the plan.md Deviations addendum (with F2).

## Triage summary

| Outcome | Findings |
|---|---|
| Fixed | F1, F2, F4, F6, F7, F8 (differently), F9 (via F2 addendum) |
| Rule | F3 (lesson "signUp has three outcomes, not two"; code unfixed) |
| Skipped | F5 |

Verification after fixes: `pnpm typecheck`, `pnpm lint`, `opennextjs-cloudflare build` all pass; workerd curl smoke re-run after F1, F7, F8.
Not runtime-verified: F4 (cookie rotation needs a signed-in session), F6 (probe command denied), F8 503 path (outage not reproducible locally).
