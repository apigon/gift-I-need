# Auth Outage Handling + Duplicate getUser Calls — Plan Brief

> Full plan: `context/changes/auth-outage-handling/plan.md`

## What & Why

During a Supabase Auth gateway outage (2026-10-19), sign-in showed "Invalid email or password." and each page load fired several parallel `GET /auth/v1/user` calls. We make outages visible to users and cut the redundant calls.

## Starting Point

`signIn`/`signUp` collapse all errors into generic copy. `getUser()` runs in both the middleware and the root layout's `AuthStatus`; `page.tsx` already uses local `getClaims()`.

## Desired End State

An outage shows an inline "temporarily unavailable, try again" Alert on both forms. One page load makes one `/auth/v1/user` call. The post-sign-out 403s are documented as benign.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| What counts as unavailable | status ≥500, timeout or network failure | The existing retryable helper misses a plain 500 |
| Behaviour during an outage | Unchanged (fail-closed, header shows signed-out) | Smallest change; keeps route protection |
| De-duplication | `AuthStatus` uses `getClaims()` | Matches `page.tsx`; ES256 JWKS verifies locally |
| 403s | Document as benign, no code | Logs show `logout?scope=global` just before |
| Sign-up | Same classifier and copy | Same bug, same fix |
| Testing | Unit tests plus a manual `edge_logs` count | Repo has no Server Component test pattern |

## Scope

**In scope:** error classifier, `signIn`/`signUp` branches, `AuthStatus` switch, comment fixes, docs and lesson.

**Out of scope:** degraded header, fail-open middleware, cookie clearing, header forwarding, retries, `/api/health`, any claim/reveal or shared-list path, the `signUp` no-session outcome.

## Architecture / Approach

`isAuthUnavailableError` in `src/utils/supabase/errors.ts` is shared by both actions. The middleware keeps its single `getUser()`; the layout reads the refreshed cookie through `getClaims()`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Outage-aware forms | Classifier, action branches, unit tests | Mislabelling a real credentials error as an outage |
| 2. One getUser | `AuthStatus` on `getClaims()` | A symmetric JWT secret would silently bring the extra call back |
| 3. Docs | `login.md` moved, lesson added | None |

**Prerequisites:** branch `GIN-39-auth-outage-handling` (exists).
**Estimated effort:** about 1 session across 3 small phases.

## Open Risks & Assumptions

- The exact 403 error code was not visible in `auth_logs`; the conclusion rests on the timing after `logout`.
- The JWT signing algorithm is assumed to stay asymmetric.

## Success Criteria (Summary)

- Simulated 5xx or network failure renders the unavailable state, distinct from invalid credentials.
- A single page load shows one Auth `/user` request.
