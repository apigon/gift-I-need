# Organizer-Blindness & Claim-Integrity Guard — Plan Brief

> Full plan: `context/changes/testing-organizer-blindness-claim-integrity/plan.md`
> Research: `context/changes/testing-organizer-blindness-claim-integrity/research.md`

## What & Why

Rollout Phase 1 of `context/foundation/test-plan.md`: close the three risks
named in `change.md` — the untested organizer-page composition, the
unguarded post-write `refresh()` call, and the missing cross-owner pgTAP
fixture. Research reframed each one narrower and cheaper than the risk
map's one-line description: none is a proven leak or a proven double-spend
today, but none was proven safe by a test either — each rests on a code
comment or a structural argument.

## Starting Point

`page.tsx` inlines its fetch-skip/merge/degrade orchestration in an async
Server Component Vitest can't render, so only the pure merge sub-piece is
tested. `lists.ts` calls `refresh()` unguarded after every committed write
in all three actions, with no error boundary anywhere in the app. pgTAP's
`03_claims.test.sql` has one organizer and two owns-nothing
guests/strangers — no cross-owner fixture exists.

## Desired End State

The organizer-page orchestration lives in a plain, directly testable
function with full branch coverage plus one real-stack integration proof.
All three write actions survive a `refresh()` throw without losing their
result to a rejected promise. pgTAP proves cross-owner rejection on all
three write RPCs. The cookbook and lessons files record what this phase
established for future phases to build on.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Fix scope for the `refresh()` gap | Guard it now (try/catch), not test-only | User chose to close the already-discovered gap in this phase rather than defer it | Plan (user) |
| Risk #1 testability | Extract orchestration into `organizer-view.ts` | Directly testable, matches the existing discriminated-union pattern, no Next.js internals to mock | Plan (user) |
| Risk #1 depth | Orchestration branches only, not clock-divergence | DB's live `reveal_open` re-derivation already structurally guarantees safety regardless of app-side clock drift | Plan (user) |
| Risk #2 blast radius | All three actions (claim/markGiven/unlock), not just claim | Identical unguarded-`refresh()` shape in all three; marginal cost is low | Plan (user) |
| Risk #2 client-layer coverage | Deferred to Phase 4 (e2e) | Avoids standing up `@testing-library/react` for one component; matches test-plan.md §7's existing stance | Plan (user) |
| Risk #3 breadth | All three write RPCs, not just `claim_item` | Each RPC has an independent `owner_id = auth.uid()` check — proving one doesn't prove the others | Plan (user) |
| Test-layer split for Risk #1 | Unit tests for branching + one real-stack integration test | Cost×signal: branching logic is cheap to mock, but the pre-reveal invariant needs real data to be believed | Plan |

## Scope

**In scope:**
- Extracting and unit-testing the organizer-page composition
- One integration test proving the pre-reveal invariant against real data
- Guarding `refresh()` in all three Server Actions + regression tests
- Cross-owner pgTAP coverage for `claim_item`/`mark_given`/`unlock_event`
- test-plan.md §6.2/§6.6 and a lessons.md entry

**Out of scope:**
- App-vs-DB reveal-clock divergence test (structural argument suffices)
- `claim-modal.tsx` component-level render tests (deferred to e2e, Phase 4)
- A general error boundary (`error.tsx`) for the app
- Re-testing the DB-level claim race or RPC-level owner-blindness (already proven)

## Architecture / Approach

New module `src/lib/lists/organizer-view.ts` composes `getOwnedEvent` +
`getSharedList` + `mergeOwnedItemsWithStatus` behind one discriminated-union
function (`getOrganizerView`), mirroring the shape those two I/O modules
already use. `page.tsx` shrinks to calling it and handling
`notFound()`/rendering. `lists.ts` gets a three-line `try/catch` around each
existing `refresh()` call, no other logic change. `03_claims.test.sql` gets
one new fixture (organizer C + event D) reused across three new assertions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Extract organizer-view composition | New testable module + full branch unit coverage | Refactor must preserve exact branch order (skip-fetch decision before merge) |
| 2. Prove pre-reveal invariant (integration) | Real-stack proof the skip-fetch path holds against live data | Needs local stack (`colima`/`supabase start`) running to actually execute, not skip |
| 3. Guard refresh() in all three actions | Regression-tested try/catch around each refresh() call | Must stay synchronous — refresh() is `void`, no `await` needed |
| 4. Cross-owner pgTAP coverage | New organizer-C fixture + 3 cross-owner assertions | Expected error codes must match each RPC's actual authorization order, not be guessed |
| 5. Cookbook + lessons sync | test-plan.md §6.2/§6.6 filled in, new lessons.md entry | None — documentation only |

**Prerequisites:** Local Supabase stack (`colima start` + `supabase start`) for Phases 2 and 4.
**Estimated effort:** ~1-2 sessions across 5 phases — Phases 1/3/4 are independent and could run in parallel; Phase 2 depends on Phase 1; Phase 5 depends on all four.

## Open Risks & Assumptions

- Phase 4's expected error codes for the cross-owner case (`owner_cannot_claim`, `not_permitted`, `event_not_found`) are inferred from each RPC's documented authorization order in research.md, not yet proven by a passing test — Phase 4 is exactly where that inference gets checked.
- The `refresh()` guard (Phase 3) is a defensive addition against an undocumented failure mode (Next's docs only describe the outside-Server-Action throw case) — if `refresh()` never actually throws in practice, the regression test still validates correct behavior, but the guard itself has no reproducible real-world trigger to demonstrate.

## Success Criteria (Summary)

- An organizer's real page load, after a real guest claim, never shows claim status pre-reveal — proven by both mock and real-stack tests, not just the RPC's own guarantee.
- A `refresh()` failure after a committed claim/mark-given/unlock never loses the write's result to the guest.
- Calling any write RPC directly against another organizer's event is rejected exactly like a stranger's call, proven by pgTAP.
