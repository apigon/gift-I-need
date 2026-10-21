<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth Outage Handling + Duplicate getUser Calls

- **Plan**: context/changes/auth-outage-handling/plan.md
- **Scope**: Full plan (3 of 3 phases)
- **Date**: 2026-10-21
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated re-run: `pnpm test` 145 passed; `pnpm lint` 0 errors (6 pre-existing warnings in src/app/actions/lists.ts); build passed at each phase.

## Findings

### F1 — "Plain 500 is not retryable" is false for the installed supabase-js

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/utils/supabase/errors.ts:14-18; context/foundation/lessons.md (last entry); src/utils/supabase/errors.test.ts (plain 500 case)
- **Detail**: The plan, the doc comment, the test label and the new lesson all say supabase-js only classes 502/503/504 as retryable, so a plain 500 would read as a bad password. In @supabase/auth-js 2.110.0, `NETWORK_ERROR_CODES` in lib/fetch.js is 500, 501, 502, 503, 504 and 520-530, and all of them throw `AuthRetryableFetchError`. So a real 500 was already covered by `isAuthRetryableFetchError`. The `status >= 500` branch only adds codes outside that list (505-519, 531+) and the test's `apiAuthError(500, ...)` is a synthetic object supabase-js would never produce. The code is harmless; the written rationale and the lesson are wrong and would mislead future work.
- **Fix A ⭐ Recommended**: Keep the classifier as a defensive superset, and correct the comment, the test label and the lesson (say supabase-js already covers 500-504 and 520-530; the extra branch is a safety net for other 5xx).
  - Strength: Keeps behaviour and tests; fixes the misinformation where it would do damage (the lesson is read by every future plan).
  - Tradeoff: Retains a branch real traffic is unlikely to hit.
  - Confidence: HIGH — read directly from fetch.js in node_modules.
  - Blind spot: Other auth-js versions may differ; the hosted behaviour was not exercised with a 500.
- **Fix B**: Delete `isAuthUnavailableError` and use `isAuthRetryableFetchError` in the actions.
  - Strength: Less code, one definition shared with the proxy and /api/health.
  - Tradeoff: Loses the safety net, and the action tests need rewriting around real retryable errors.
  - Confidence: MEDIUM — depends on how much you trust the 5xx coverage staying stable across upgrades.
  - Blind spot: Behaviour on a future auth-js that narrows the list.
- **Decision**: FIXED via Fix A (comment, test labels now use 505, lesson corrected)

### F2 — Yoda copy and two messages deviate from the plan and would ship to users

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/app/actions/auth.ts:32-35; src/app/actions/auth.test.ts:23-30
- **Detail**: The plan specified one plain message ("Sign-in is temporarily unavailable...") for both forms. The split into two messages was a deliberate improvement, but the Yoda wording was a playful override and is pinned in the tests. Not yet decided whether it is meant for production.
- **Fix**: Decide before the PR; if plain, change the two constants and the two test constants.
- **Decision**: ACCEPTED — keep Yoda copy and the two separate messages

### F3 — Header can show signed-in for a session revoked elsewhere

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/app/components/auth-status/auth-status.tsx:29-31
- **Detail**: `getClaims()` verifies the JWT signature and expiry only, not that the session row still exists. `signOut` uses scope global (logs show `logout?scope=global`), so after signing out on device A, device B's middleware `getUser()` correctly sees no user, but its header keeps showing the email until the access token expires (Supabase default 1 hour). Display only: protected routes still redirect via the middleware, and the shared-list/claim path is untouched. The plan's caveat covered HS256 but not this.
- **Fix**: Add one sentence to the COST comment in auth-status.tsx naming this window and that it is accepted (display-only; middleware still enforces).
  - Strength: Records the trade-off where the next reader will look.
  - Tradeoff: None; documentation only.
  - Confidence: HIGH — follows from getClaims semantics and the observed global logout.
  - Blind spot: Actual JWT TTL of this project was not checked.
- **Decision**: FIXED — caveat added to the AuthStatus COST comment. Sign-out stays global (user decision); revoked-session window for data/RPC path is out of GIN-39 scope, tracked as #40

### F4 — .mcp.json is unplanned and runs an unpinned package with an account token

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .mcp.json:5-8
- **Detail**: Included in the Phase 1 commit at your request, but not in the plan or the issue. It launches `npx -y @supabase/mcp-server-supabase@latest` with `SUPABASE_ACCESS_TOKEN`, an account-wide token (login.md already flags one such token as leaked). `--read-only` limits the damage, but `@latest` means each launch runs whatever version is current.
- **Fix**: Pin an exact version in the args, or move it to its own PR.
- **Decision**: FIXED — pinned to @supabase/mcp-server-supabase@0.14.0 (latest, published 2026-10-14)

### F5 — Test-only helper lives in the production source tree

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/utils/supabase/test-errors.ts
- **Detail**: Not in the plan. Placed under `src/utils/supabase/` because ESLint only allows value imports of supabase-js there. Nothing in app code imports it, so it is not bundled.
- **Fix**: None needed; optionally add a `test-` exclusion comment in eslint config later.
- **Decision**: FIXED — moved to src/test-utils/supabase-errors.ts, added to the ESLint by-value-import allow-list
