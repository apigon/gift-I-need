# Auth Outage Handling + Duplicate getUser Calls Implementation Plan

## Overview

On 2026-10-19 Supabase Auth returned gateway 504s for about 7 minutes. The app showed "Invalid email or password." for every failure, and each page load fired several parallel `GET /auth/v1/user` calls, multiplying load during the incident. This plan (GitHub #39) makes sign-in/sign-up say "service unavailable" when Auth is down, removes the redundant `getUser` per request, and records why the post-sign-out 403s are benign.

## Current State Analysis

- `signIn` maps **every** `signInWithPassword` error to `GENERIC_SIGN_IN_ERROR` (`src/app/actions/auth.ts:85-87`). `signUp` maps every error except "already registered" to `GENERIC_ERROR` (`:130-146`).
- `isAuthRetryableFetchError` is re-exported in `src/utils/supabase/errors.ts`, but supabase-js only classes 502/503/504 and network failures as retryable; a plain 500 arrives as an ordinary `AuthApiError`.
- `getUser()` runs in the middleware (`src/utils/supabase/proxy.ts:74`) **and** in the root layout's `AuthStatus` (`src/app/components/auth-status/auth-status.tsx:24`) on every request. Prefetched links make each of those its own request.
- `src/app/page.tsx` already uses `getClaims()`. The hosted project signs JWTs with ES256 (JWKS at `/auth/v1/.well-known/jwks.json` serves an EC key), so `getClaims()` verifies locally with no `/user` round trip.
- The 403s in `login.md` (12:37:10Z) follow a `POST /auth/v1/logout?scope=global → 204` at 12:37:09.866Z. They are the post-`signOut` redirect request carrying the revoked session, not a stale cookie from an earlier visit. Three fired within 14 ms because of the duplicate-call problem.

## Desired End State

- A 5xx, timeout or network failure on sign-in or sign-up renders an inline `Alert` with an "unavailable, try again" message, distinct from "Invalid email or password."
- One page load issues one Auth `/user` request (verified in `edge_logs`).
- The 403-after-sign-out behaviour is documented as benign.

### Key Discoveries:

- `src/app/page.tsx:7-13` already documents the `getClaims()` trade-off, and `auth-status.tsx:14-19` names it as the escape hatch.
- Both forms already render `state.message` in `<Alert tone="danger">` (`sign-in-form.tsx:41`); no UI change is needed.
- `src/app/actions/auth.ts:89-91` forbids try/catch because `redirect()` throws; the new branch must stay a plain `if (error)`.
- `lessons.md`: Supabase auth methods return errors and do not throw, so check the returned `error`.

## What We're NOT Doing

- No degraded or "unknown" header state; `AuthStatus` still renders signed-out when the user cannot be resolved.
- No fail-open middleware; route protection stays fail-closed.
- No middleware cookie clearing for 403 `session_not_found`.
- No forwarding the user via request headers, and no `React.cache` wrapper around `getUser`.
- No change to `shared-list.ts`, the claim/reveal RPCs, or any list-read caching.
- No retry logic, and no change to `/api/health`.
- The `signUp` "no session, no error" outcome from `lessons.md` is a separate issue.

## Implementation Approach

Two independent code changes plus a docs close-out. The classifier lives next to the existing `isAuthRetryableFetchError` re-export so Edge-safe and server callers share one definition. The de-duplication keeps the middleware's single `getUser()` (it validates and refreshes the session) and has the layout read the already-refreshed cookie via `getClaims()`.

## Phase 1: Outage-aware sign-in and sign-up

### Overview

Add a shared "Auth is unavailable" classifier and use it in both Server Actions.

### Changes Required:

#### 1. Classifier

**File**: `src/utils/supabase/errors.ts`

**Intent**: Export `isAuthUnavailableError(error)`, true for retryable fetch errors, network failures with no HTTP status, and any `status >= 500`. Null or undefined is false. Keep the "no direct supabase-js imports outside `src/utils/supabase/**`" rule intact.

**Contract**: `isAuthUnavailableError(error: AuthError | null | undefined): boolean`. Pure, Edge-safe, no new dependencies.

#### 2. Server Actions

**File**: `src/app/actions/auth.ts`

**Intent**: Before the generic mapping, return `{ status: "error", message: AUTH_UNAVAILABLE_ERROR }` when the classifier matches, in both `signIn` and `signUp`. Add the constant beside the others with a comment on the copy policy: an outage message leaks nothing about the account, unlike a credentials-specific one. Log the raw error with `console.error("[auth] ...")`, matching the `[proxy]` and `[health]` convention.

**Contract**: `AUTH_UNAVAILABLE_ERROR = "Sign-in is temporarily unavailable. Please try again in a few minutes."` (sign-up uses the same wording). No try/catch is introduced.

#### 3. Tests

**File**: `src/app/actions/auth.test.ts` (new), `src/utils/supabase/errors.test.ts` (new)

**Intent**: Mocked-client Vitest tests in the style of `src/app/actions/lists.test.ts`. Classifier cases: 502/503/504 retryable, plain 500, network failure, 400 `invalid_credentials`, 429, null. Action cases: `signIn` returns the unavailable message on 504 and the generic one on `invalid_credentials`; `signUp` returns the unavailable message on 5xx, "already registered" is unchanged, and other 4xx stay generic.

**Contract**: mock `@/utils/supabase/server` and `next/navigation` (`redirect` throws a sentinel). Assert behaviour (returned `FormState`), not call internals.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- Type checking and build pass: `pnpm build`

#### Manual Verification:

- With the Supabase URL pointed at an unreachable host in `.env.local`, submitting the sign-in form shows the unavailable Alert, and a wrong password on a reachable project still shows "Invalid email or password."
- Same check on `/signup`.

**Implementation Note**: After automated checks pass, pause for manual confirmation before Phase 2.

---

## Phase 2: One getUser per request

### Overview

Remove the redundant `getUser()` from the root layout.

### Changes Required:

#### 1. AuthStatus

**File**: `src/app/components/auth-status/auth-status.tsx`

**Intent**: Replace `getUser()` with `getClaims()` and read the email from the claims. Rewrite the COST comment: the middleware already validated and refreshed the session, and the layout verifies the JWT locally against the cached JWKS.

**Contract**: signed-in when `data?.claims` is present; display `claims.email`. Rendering for both states is unchanged.

#### 2. Stale comments

**Files**: `src/app/page.tsx`, `src/app/layout.tsx`

**Intent**: `page.tsx:7-10` says the layout "pays one getUser() round trip" and `layout.tsx:41` says AuthStatus calls `getUser()`. Update both so they describe the new state.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- On the deployed preview, a single page load shows one `GET /auth/v1/user` in `edge_logs` (plus at most one JWKS fetch), down from several.
- Header still shows the email and Sign out when signed in, and Sign in / Create account when signed out.
- After Sign out, the redirect to `/` shows the signed-out header and `/auth/v1/user` returns no 403 burst.

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Document and close out

### Overview

Record the 403 decision and the follow-ups.

### Changes Required:

#### 1. login.md

**File**: `login.md`

**Intent**: Move it into the change folder (`context/changes/auth-outage-handling/login.md`; it is untracked). Replace the "New observation" section with the finding that the 403s follow `logout?scope=global`, and mark steps 2 and 3 done. Steps 4 and 6 (rotate the `sbp_` token, check the status page) stay open as non-code follow-ups.

#### 2. Lessons

**File**: `context/foundation/lessons.md`

**Intent**: Add a lesson via `/10x-lesson`: middleware `getUser()` already validates the session, so Server Components should use `getClaims()`; and `isAuthRetryableFetchError` misses plain 500s.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`

#### Manual Verification:

- `login.md` and the lesson read correctly.

---

## Testing Strategy

### Unit Tests:

- Classifier truth table and `signIn`/`signUp` outcome mapping (Phase 1). The unavailable message must never appear for `invalid_credentials`.

### Manual Testing Steps:

1. Unreachable Supabase URL: sign-in and sign-up show the unavailable Alert.
2. Reachable project: wrong password shows the generic message; right password signs in.
3. Deployed app: count `/auth/v1/user` calls for one page load in `edge_logs`.
4. Sign out and confirm there are no 403s.

## Performance Considerations

`getClaims()` verifies ES256 locally with a cached JWKS, saving one network round trip per request. If the project ever moves to a symmetric (HS256) JWT secret, `getClaims()` falls back to a `/user` call and the saving disappears.

## References

- Issue: GitHub #39 (`apigon/gift-I-need`)
- Investigation: `login.md`
- Pattern: `src/app/actions/lists.test.ts`; `src/app/page.tsx:7-13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Outage-aware sign-in and sign-up

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test`
- [x] 1.2 Linting passes: `pnpm lint`
- [x] 1.3 Type checking and build pass: `pnpm build`

#### Manual

- [x] 1.4 Unreachable Supabase URL shows the unavailable Alert on sign-in; wrong password still shows "Invalid email or password."
- [x] 1.5 Same check on `/signup`

### Phase 2: One getUser per request

#### Automated

- [ ] 2.1 Unit tests pass: `pnpm test`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 Build passes: `pnpm build`

#### Manual

- [ ] 2.4 One `GET /auth/v1/user` per page load in `edge_logs` on the deployed preview
- [ ] 2.5 Header renders correctly signed in and signed out
- [ ] 2.6 No 403 burst after Sign out

### Phase 3: Document and close out

#### Automated

- [ ] 3.1 Lint passes: `pnpm lint`

#### Manual

- [ ] 3.2 `login.md` and the lesson read correctly
