# Surprise-Rule Data Contract (F-02) — Plan Brief

> Full plan: `context/changes/surprise-rule-data-contract/plan.md`
> Research: `context/changes/surprise-rule-data-contract/research.md`

## What & Why

GIN's core promise is that guests coordinate gifts openly while the organizer stays blind to claims until the reveal. This change is the first database contract: the events/items/claims schema, with organizer-blindness and single-claim enforced **in Postgres**. It has to be Postgres because the anon key is public and there is no privileged client, so a filter in the UI or the app protects nothing.

## Starting Point

There is no schema, no migrations and no test runner. All Supabase access uses the anon key under RLS, with no service-role key by decision. The `/lists/` route prefix is already public for the shared list. Unit-test targets from F-01 are waiting for a runner.

## Desired End State

What each kind of viewer can do:

| Viewer | Before the reveal | After the reveal |
|---|---|---|
| Signed-out visitor, with the link | Sees items; no status | Sees items; no status |
| Signed-in guest | Sees available / taken / mine; can claim once per item | Sees statuses including given; claiming is closed; can mark their item given |
| Organizer | Sees no status at all | Sees available / taken / given; can mark an item given; never learns who claimed |

Underneath that:

- A true race on one item yields exactly one winner.
- The reveal happens automatically at 00:00 on event day + 2, in the event's timezone. The organizer can unlock it manually from event day + 1.
- pgTAP and Vitest suites lock every rule.
- The schema is live on the hosted project, and the PRD and roadmap describe the rule as built.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Where the gate is enforced | RLS plus one `private.reveal_open` helper; no parallel app-side filter | Only Postgres holds against direct PostgREST calls, and a second copy of the rule adds a second clock | Research |
| Reveal timing | Automatic at 00:00 on event day + 2 in the event's IANA timezone; manual unlock from event day + 1 | Allows late claims, and a second-account organizer could peek anyway | Research |
| Event date and timezone edits | Immutable after creation | Backdating would open the reveal early | Plan |
| Accepted event dates | Today or later (in the event's timezone), no upper bound | A past date would create a list that is revealed on arrival | Plan |
| Status for signed-out visitors | None; status requires sign-in | Closes the "organizer peeks while signed out" hole | Research |
| Claimer identity for the organizer | Never shown, even after the reveal | Stricter surprise rule; also means no profiles table is needed | Plan |
| Claims table access | No grants to any API role; everything goes through RPCs | RLS can't hide columns, and an UPDATE needs SELECT, so sealing the table is simplest to prove | Plan |
| Single-claim | `UNIQUE(item_id)`; race loser gets `23505`, shown as `already_taken` | The only mechanism that is race-safe | Research |
| Owner claims on their own list | Rejected, with the same error whether or not the item is taken | The error can't be used to probe claim status | Research / Plan |
| When claims close | At the reveal, manual or automatic | After the reveal the list is read-only except for "given" | Research |
| "Given" | One irreversible mark; either party, only after the reveal; a repeat mark does nothing | Matches irreversible claims, and needs the fewest rules | Research / Plan |
| TypeScript scope | Generated types plus a `server-only` data-access module in `src/lib/lists/` | Slices get one audited, uncached path, and the error mapping is tested once | Plan |
| Tests | pgTAP (primary), Vitest unit tests, one race integration test, plus the queued F-01 pure tests | pgTAP proves the policies; only real connections prove a race | Research / Plan |
| Hosted rollout | You run `supabase db push` at the end of F-02 | Verifies the hosted privileges while nothing reads the schema yet | Plan |

## Scope

**In scope:**
- Vitest and the test scripts; the queued F-01 tests
- Two migrations (schema and write rules; read RPCs) and four pgTAP suites
- Generated types, the data-access module, the race test, and lint guards against `unstable_cache` and direct supabase-js imports
- PRD, roadmap and stale-doc updates, and the hosted push

**Out of scope:**
- All UI, routes and Server Actions (S-01 to S-05)
- Profiles, unclaim, un-marking given, deletion, link revocation
- Key hygiene, CAPTCHA and rate limits, CI gating, the preview-URL guard, component tests

## Architecture / Approach

Deny everything by default, then open the minimum:

- The first migration revokes default privileges.
- Each table ships with RLS and grants scoped to specific columns. Nothing gets `DELETE`, and `anon` gets nothing.
- The organizer reads and writes their own events and items directly, scoped by RLS.
- Anything touching claims, or crossing the owner boundary, is an RPC: `get_shared_event`, `get_shared_items`, `claim_item`, `mark_given`, `unlock_event`. Each is a thin wrapper in `public` over a SECURITY DEFINER body in an unexposed `private` schema.
- A trigger precomputes the reveal instants from the immutable date and timezone, so the gate compares the database clock against a single column.
- Rule violations raise `P0001` with a stable key. The data-access module maps each key to a typed error code.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Test harness and housekeeping | Vitest projects, test scripts, F-01 unit tests, package rename | The `server-only` and `@/` aliases must resolve under Vitest |
| 2. Schema, write rules and privileges | Migration 1, triggers, grants, RLS, write RPCs, three pgTAP suites | A grant that is too broad; the timezone arithmetic |
| 3. Shared-list read RPCs | Migration 2, per-viewer status, the read-matrix pgTAP suite | Leaking status to the organizer, or leaking identity |
| 4. TypeScript contract | Types, data-access module, error mapping, race test, lint guards | A flaky race test; local rate limits |
| 5. Docs and hosted rollout | PRD and roadmap aligned, stale docs fixed, `db push` and probes | The production migration is forward-only |

**Prerequisites:** colima and the local Supabase stack running (`colima start`, `supabase start`); `.env.localdb` filled with the local anon key; access to push to the hosted project.
**Estimated effort:** about 3–4 sessions across 5 phases. Phase 2 is the largest.

## Open Risks & Assumptions

- **Previews still hit the production database.** The preview-URL guard stays open, and must fire before any claim UI ships (S-02/S-03).
- **The automatic reveal can't be locked against in-flight claims.** A claim that starts a millisecond before the reveal may commit just after it. This is accepted.
- **A second account lets a determined organizer see status.** This is accepted, and recorded in the PRD.
- **The integration test creates real local accounts on every run.** 6 auth calls per run, against a local limit of 30 per 5 minutes; `supabase db reset` clears the data.
- **Assumed:** the `pgcrypto` and `pgtap` extensions are available locally and on the hosted project (both are standard on Supabase).

## Success Criteria (Summary)

- An organizer can't learn any claim state before the reveal through any path (table, RPC, error message, refresh or race), and never learns claimer identity.
- Two guests racing for one item always produce exactly one claim.
- `pnpm test`, `pnpm test:db` and `pnpm test:integration` pass locally, and after the push the hosted Security Advisor shows no RLS, definer-exposure or search-path findings.
