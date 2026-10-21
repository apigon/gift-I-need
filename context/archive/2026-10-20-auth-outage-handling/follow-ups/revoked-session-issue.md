# GitHub issue #40 — created (apigon/gift-I-need/issues/40)

**Title:** Revoked sessions keep working on the data path until the access token expires

**Label:** bug (suggested)

## Context

`signOut()` is global (`POST /auth/v1/logout?scope=global`, see `src/app/actions/auth.ts`), so signing out on one device revokes every session the user has. Revoking deletes the session row and the refresh token, but an access token already issued to another device is a signed JWT and stays valid until it expires (Supabase default: 1 hour; this project's setting not checked).

- Protected routes: the middleware's `getUser()` asks Supabase whether the session still exists, so a revoked session is redirected to `/login`.
- Header: `AuthStatus` uses `getClaims()` (GIN-39), which checks signature and expiry only, so it can keep showing the email. Display only, documented in `auth-status.tsx`.
- Data path: Postgres/PostgREST validate only the JWT, so `auth.uid()` still resolves for a revoked session. This is not new: the old `getUser()` in the layout never protected it either.

## To verify (not confirmed yet)

- Whether `claim_item`, `mark_given`, `unlock_event` and the other write RPCs check anything beyond `auth.uid()`.
- Whether a revoked device can still claim via a Server Action on a public route (`/lists/[token]`), which skips the middleware's redirect.
- The project's actual JWT expiry setting (Dashboard → Authentication → JWT expiry).

## Options

1. Shorten JWT expiry in the dashboard. Cheap, but only narrows the window.
2. Add a session-exists check to the claim and write RPCs: a `SECURITY DEFINER` function that compares the JWT's `session_id` claim against `auth.sessions`, with grants, RLS and pgTAP coverage in the same migration (per CLAUDE.md). This is the real fix.

## Notes

- Follow-up from GIN-39 (review finding F3). #39 only documents the header side.
- Touches the claim path, so the organizer-blindness guardrails in CLAUDE.md apply: no claim status, claimer identity or counts may leak, and the change goes through the `get_shared_*` / `claim_item` RPCs, not direct table access.
