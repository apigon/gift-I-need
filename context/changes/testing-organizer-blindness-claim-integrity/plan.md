# Organizer-Blindness & Claim-Integrity Guard Implementation Plan

## Overview

Close the three gaps `research.md` grounded for Rollout Phase 1: the untested
application-layer composition on the organizer's page (Risk #1), the
unguarded `refresh()` call after a committed claim/mark-given/unlock write
(Risk #2), and the missing cross-owner pgTAP fixture on the write RPCs (Risk
#3). This is a testability + coverage effort, not a bug-fix workflow — the
one production change in scope (guarding `refresh()`) was deliberately
chosen by the user over a test-only approach for that specific,
already-discovered gap.

## Current State Analysis

- `src/app/events/[id]/page.tsx` inlines the fetch-skip/merge/degrade
  orchestration directly in an async Server Component, which Vitest cannot
  render — so today only the pure sub-piece (`mergeOwnedItemsWithStatus`,
  via `reveal-status.test.ts`) has coverage, not the orchestration around it.
- `src/app/actions/lists.ts` calls `refresh()` unguarded, with no
  `try/catch`, after a successful write in all three actions
  (`claimItemAction`, `markGivenAction`, `unlockEventAction`) — and after
  every outcome, success or failure, in `claimItemAction` specifically,
  since a failed claim still needs the item's real status re-fetched. The
  app has no `error.tsx`/`global-error.tsx` anywhere, so a throw there
  surfaces as Next's default crash screen even though the write already
  committed.
- `supabase/tests/03_claims.test.sql` has one organizer fixture
  (`...b1`) and two guest/stranger fixtures who own nothing — no fixture
  exercises a second, unrelated organizer calling a write RPC on the first
  organizer's event.

## Desired End State

- A new `src/lib/lists/organizer-view.ts` module owns the fetch-skip/merge/
  degrade orchestration; `page.tsx` calls it and only handles
  `notFound()`/rendering. The module's branches are unit-tested, and one
  integration test proves the pre-reveal invariant against the real local
  Supabase stack (real event, real guest claim, real RPC).
- All three Server Actions in `lists.ts` survive a `refresh()` throw without
  rejecting their caller's promise; each has a regression test proving it.
- `03_claims.test.sql` proves `mark_given` and `unlock_event` reject a
  cross-owner caller the same way they reject a stranger, and that
  `claim_item` correctly treats a cross-owner caller like any other guest
  (allowed), matching each RPC's actual per-event ownership scoping.
- `test-plan.md` §6.2 and §6.6 are filled in; `lessons.md` records the
  "cheap local check, never trust it for security" pattern as confirmed.

### Key Discoveries:

- `src/app/events/[id]/page.tsx:59-82` — the exact orchestration block to
  extract: `revealOpen` branch, `getSharedList` call, `statusUnavailable`
  flag, `mergeOwnedItemsWithStatus` call.
- `src/lib/lists/owned-events.ts:105-176` (`getOwnedEvent`) and
  `src/lib/lists/shared-list.ts:17-67` (`getSharedList`) already return
  discriminated `{ kind: ... }` unions — the new module follows the same
  shape rather than inventing one.
- `src/lib/lists/reveal-status.ts:1-6`'s header comment explains why the
  pure merge function lives apart from both I/O modules — the new
  orchestration module is the natural home for calling all three together,
  not a fourth place.
- `node_modules/next/dist/server/web/spec-extension/revalidate.d.ts:22` —
  `refresh(): void` is synchronous, so a plain `try/catch` (no `await`)
  is sufficient to guard it; confirmed against
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md`,
  which only documents it throwing when called outside a Server Action.
- `src/lib/lists/claim-race.integration.test.ts` is the only existing
  integration test — its pattern (real `@supabase/supabase-js` client, anon
  key only, `it.skipIf(!ENV_READY)`, `signedInClient` helper) is the template
  for Phase 2's new integration test.
- `supabase/tests/03_claims.test.sql`'s existing fixture/role-switching
  pattern (`set_config('request.jwt.claims', ...)`, `\gset` for captured
  ids) is the template for Phase 4's new organizer-C fixture.

## What We're NOT Doing

- Not testing the app-vs-DB reveal-clock divergence directly (research
  Open Question 1) — the DB's live `reveal_open` re-derivation on every
  `get_shared_items` call structurally guarantees no leak regardless of
  app-side clock drift; proving the orchestration's branches is the
  cheaper, sufficient signal.
- Not adding `@testing-library/react` or any component-render test for
  `claim-modal.tsx`'s toast/close-timing gap — deferred to Rollout Phase 4
  (e2e), matching `test-plan.md` §7's existing stance against standing up a
  new render-test layer for one component.
- Not adding a general error boundary (`error.tsx`/`global-error.tsx`) to
  the app — out of scope; the `refresh()` guard in Phase 3 is narrowly
  scoped to the one already-discovered gap, not a general error-handling
  pass.
- Not touching `mark_given`'s "skip refresh on failure" or
  `unlock_event`'s equivalent — those paths are unchanged and already
  covered by `lists.test.ts`; only the guard around the *existing*
  `refresh()` calls is new.
- Not re-testing the DB-level unique-constraint race (already proven by
  `claim-race.integration.test.ts`) or RPC-level owner-blindness
  (already proven by `04_shared_list.test.sql`/`05_owner_direct_reads.test.sql`).

## Implementation Approach

Five phases, each landing one coherent unit: extract (1) → prove
end-to-end (2) → guard the write actions (3) → extend pgTAP (4) → close out
the cookbook/lessons paperwork (5). Phases 1–2 and 3 are independent of each
other (different files) and could run in any order; 4 is fully independent.
5 depends on 1–4 being done since it documents what they taught.

## Critical Implementation Details

### State sequencing (Phase 1/2)

`organizer-view.ts` must preserve the exact branch order from `page.tsx`
today: check `result.kind` from `getOwnedEvent` first (passthrough
`not_found`/`error` untouched), only then branch on `event.revealOpen` to
decide whether to call `getSharedList` at all. Reversing this (e.g. always
calling `getSharedList` and discarding the result when closed) would
reintroduce the exact "RPC call whose result is thrown away" the current
code comment says to avoid — cheap to get wrong, cheap to get right.

## Phase 1: Extract organizer-view composition + unit coverage

### Overview

Move the fetch-skip/merge/degrade orchestration out of `page.tsx` into a new,
directly testable module, and unit-test every branch with the codebase's
existing mocked-dependency pattern.

### Changes Required:

#### 1. New orchestration module

**File**: `src/lib/lists/organizer-view.ts`

**Intent**: Own the composition `page.tsx:59-82` currently performs inline —
decide whether to fetch shared status (based on `event.revealOpen`), call
`getSharedList` when open, merge via `mergeOwnedItemsWithStatus`, and set
`statusUnavailable` when the shared-list read fails or degrades. Passes
through `getOwnedEvent`'s `not_found`/`error` outcomes unchanged.

**Contract**: `getOrganizerView(eventId: string)` returns a discriminated
union following the `getOwnedEvent`/`getSharedList` shape:
`{ kind: "ok"; event: OwnedEvent; items: OwnedItemWithStatus[]; statusUnavailable: boolean } | { kind: "not_found" } | { kind: "error"; code: ListErrorCode }`.
Calls `getOwnedEvent`, `getSharedList`, and `mergeOwnedItemsWithStatus` —
no direct Supabase client or `connection()` call of its own, since those
already live in the modules it calls.

#### 2. Wire `page.tsx` to the new module

**File**: `src/app/events/[id]/page.tsx`

**Intent**: Replace the inline orchestration block with a single call to
`getOrganizerView(id)`, keeping `notFound()`/error-alert rendering and
`buildSiteUrl`/JSX unchanged.

**Contract**: `page.tsx` imports `getOrganizerView` from
`@/lib/lists/organizer-view` instead of importing `getSharedList` and
`mergeOwnedItemsWithStatus` directly; `getOwnedEvent` stays imported only if
still referenced (it isn't, once extraction is complete — remove the
now-unused import).

#### 3. Unit tests for the new module

**File**: `src/lib/lists/organizer-view.test.ts`

**Intent**: Prove every branch of the orchestration in isolation, mocking
`getOwnedEvent`, `getSharedList`, and `mergeOwnedItemsWithStatus` the way
`lists.test.ts` mocks `shared-list.ts` (`vi.mock` on the module, not the
Supabase client — those three functions already have their own DB-facing
coverage).

**Contract**: Cover, at minimum:
- `getOwnedEvent` returns `not_found` → passthrough, `getSharedList` never
  called.
- `getOwnedEvent` returns `error` → passthrough, `getSharedList` never
  called.
- `event.revealOpen` is `false` → `getSharedList` never called,
  `statusUnavailable` is `false`, every item's status is `null` (via a real
  call to the actual `mergeOwnedItemsWithStatus` with `sharedItems: null`,
  not a mock — pins the "skip-fetch always nulls" invariant end-to-end
  within the unit test).
- `event.revealOpen` is `true` and `getSharedList` returns `kind: "ok"` →
  merge is called with the real shared items, `statusUnavailable` is
  `false`.
- `event.revealOpen` is `true` and `getSharedList` returns `kind: "error"`
  or `kind: "not_found"` → `statusUnavailable` is `true`, items still
  render with `status: null` (degrade, not fail).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Organizer page still renders correctly pre- and post-reveal in a local
  dev run (`pnpm dev:local`) — no visual/behavioral change from the
  refactor.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Prove the pre-reveal invariant end-to-end (integration)

### Overview

One real-stack integration test that does what a mocked unit test
structurally cannot: prove that after a *real* guest claim, against a
*real* database, the organizer's *real* composed read never carries claim
status pre-reveal — closing the gap research named ("the RPC nulling status
is sufficient" must not be the only proof).

### Changes Required:

#### 1. Integration test

**File**: `src/lib/lists/organizer-view.integration.test.ts`

**Intent**: Using the same real-client pattern as
`claim-race.integration.test.ts` (anon key, `signedInClient` helper,
`it.skipIf(!ENV_READY)`), create a real event as an organizer, a real item,
have a real guest claim it via the real `claim_item` RPC, then call
`getOrganizerView` as the organizer and assert the returned item's status is
`null` and `statusUnavailable` is `false` — proving the skip-fetch path
holds against live data, not just a mock.

**Contract**: No new fixture helpers beyond what
`claim-race.integration.test.ts` already established
(`signedInClient`/`uniqueEmail`) — reuse them. Test file naming
(`<module>.integration.test.ts`) and `testTimeout` follow the existing
`vitest.config.mts` `integration` project, so no config changes are needed.

### Success Criteria:

#### Automated Verification:

- Integration test passes: `pnpm test:integration` (needs `colima start` +
  `supabase start`)
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Test is confirmed to actually exercise the real RPC (not silently
  skipped) by checking `ENV_READY` is true when `colima`/`supabase` are
  running locally.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Guard `refresh()` in all three Server Actions

### Overview

Wrap the unguarded `refresh()` call in `claimItemAction`, `markGivenAction`,
and `unlockEventAction` so a post-commit throw can't turn an already-
successful write into a rejected action promise. Regression-test each.

### Changes Required:

#### 1. Guard the three `refresh()` call sites

**File**: `src/app/actions/lists.ts`

**Intent**: A `refresh()` throw after a committed write must never prevent
the action from returning its normal (`idle` or `error`) result to the
caller — the write already happened; losing the return value is strictly
worse than a stale client view. Log the caught error so a real occurrence is
still visible in server logs.

**Contract**: Each of the three `refresh()` call sites becomes
`try { refresh(); } catch (error) { console.error("[actions/lists] refresh() failed after a committed write", error); }`
— `refresh` is synchronous (confirmed via
`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts:22`), so
no `await` is introduced. The function's return statements and existing
`result.ok` branching are otherwise unchanged.

#### 2. Regression tests

**File**: `src/app/actions/lists.test.ts`

**Intent**: Prove each action still resolves with its correct result when
`refresh()` throws, instead of the promise rejecting.

**Contract**: For each of `claimItemAction`, `markGivenAction`,
`unlockEventAction`: mock the underlying RPC call (`claimItem`/
`markGiven`/`unlockEvent`) to resolve `{ ok: true }`, mock `refresh` via
`refresh.mockImplementation(() => { throw new Error("refresh failed"); })`,
and assert the action still resolves to `{ status: "idle" }` (not a
rejection) — following the existing `beforeEach`/`vi.mock` structure already
in the file.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Claiming an item in a local dev run still shows the success toast and
  updated status as before — no behavior change on the happy path.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Cross-owner pgTAP coverage

### Overview

Extend the existing pgTAP claims suite with a second, unrelated organizer.
Prove `mark_given` and `unlock_event` reject a cross-owner caller identically
to a stranger, and prove `claim_item` correctly does *not* reject a
cross-owner caller — each RPC's owner check is scoped to the specific event,
not "is this caller an owner of anything."

### Changes Required:

#### 1. Cross-owner fixture and assertions

**File**: `supabase/tests/03_claims.test.sql`

**Intent**: Add a fourth `auth.users` fixture (organizer C, owning a fresh
event D with its own item) and, for each of `claim_item`, `mark_given`, and
`unlock_event`, assert that organizer A (the existing `...b1` owner) calling
the RPC against organizer C's event/item is rejected the same way the
existing stranger case is — extending, not replacing, the existing
same-event unauthorized assertions.

**Contract**: Follow the file's existing fixture/role-switching pattern
(`insert into auth.users`, `set_config('request.jwt.claims', ...)`, `\gset`
for captured ids). Bump `select plan(26)` to the new total assertion count.

`claim_item`'s owner-exclusion check (`private.is_event_owner`) is scoped to
the *specific event being claimed against*, not "is this caller an owner of
anything" — a caller who owns a different event is indistinguishable from
any other guest to this check, exactly like the existing stranger who owns
nothing (see the file's own "guest A claims item I1" `lives_ok` assertion).
So organizer A calling `claim_item` on organizer C's event D item is
expected to **succeed** (`lives_ok`), not be rejected — this sub-case proves
the RPC does *not* wrongly generalize "owner of something" into "owner of
this," guarding against a future regression that would over-broadly block
any organizer from claiming elsewhere. Only `claim_item` against the
caller's *own* event throws `owner_cannot_claim` (already covered by the
existing same-event assertions, unaffected by this phase).

For `mark_given`, an unrelated organizer calling on a claim they don't hold
and don't own hits `not_permitted`, mirroring the existing stranger
assertion — reaching that branch requires event D's item to already be
claimed (by a guest, not organizer A) and event D to be revealed first (via
the same manual-unlock time-travel pattern already used for ev1/ev3 in this
file), since `mark_given` checks `not_revealed` and `not_claimed` before
`not_permitted`.

For `unlock_event`, the cross-owner call must produce `event_not_found` — the
same enumeration-resistant code the existing "stranger" case already
asserts, per the file's own note that non-existent and not-yours
deliberately collapse to one code. No extra fixture state is needed here:
`unlock_event`'s owner check runs first, before any unlockable_at/reveal
check.

### Success Criteria:

#### Automated Verification:

- pgTAP suite passes: `pnpm test:db` (needs `colima start` + `supabase start`)

#### Manual Verification:

- None beyond the automated pgTAP run — this phase has no application-layer
  surface to exercise manually.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Cookbook + lessons sync

### Overview

Close out the paperwork this rollout phase owes: fill in the two
`test-plan.md` cookbook stubs this phase's new test types unblock, and
record the now-proven "cheap local check, never trust it for security"
pattern in `lessons.md`.

### Changes Required:

#### 1. Integration test cookbook entry

**File**: `context/foundation/test-plan.md`

**Intent**: Replace §6.2's "TBD — see §3 Phase 1" with the real convention
this phase established.

**Contract**: §6.2 states: location (co-located,
`<module>.integration.test.ts`), the `it.skipIf(!ENV_READY)` +
`signedInClient` pattern, and that it needs `colima start` + `supabase
start` via `pnpm test:integration`. Point to both
`claim-race.integration.test.ts` (original) and
`organizer-view.integration.test.ts` (this phase's addition) as references.

#### 2. Per-rollout-phase notes

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in §6.6 with what this phase taught: extracting inline
Server Component orchestration into a plain function is the pattern for
making async-Server-Component-adjacent logic testable at all in this stack;
the "which layer proves which invariant" split (unit for branching, one
integration test for the real-data proof) that Phase 1/2 used.

**Contract**: A short dated entry under §6.6, following the section's
existing "captures anything surprising the phase taught" framing — prose,
not a new subsection structure.

#### 3. Lessons entry

**File**: `context/foundation/lessons.md`

**Intent**: Research's Architecture Insight #2 flagged this pattern as
"implicit ... but never stated as a rule" — now that Phase 1/2 has proven
the DB-side `reveal_open` re-derivation makes the app-side JS clock
computation safe to be wrong, promote it to a stated lesson.

**Contract**: A new `##`-level entry following the file's existing
Context/Problem/Rule/Applies-to structure (see e.g. the "Column-scoped
grants only cover INSERT/UPDATE" entry for the exact shape), citing
`owned-events.ts`'s `revealOpen` computation and
`private.get_shared_items`'s live re-derivation as the concrete instance.

### Success Criteria:

#### Manual Verification:

- `test-plan.md` §6.2/§6.6 and `lessons.md` read correctly as prose when
  reviewed by the human.

**Implementation Note**: This is the final phase — no further pause is
needed beyond the human's read-through.

---

## Testing Strategy

### Unit Tests:

- `organizer-view.test.ts` — all orchestration branches (Phase 1).
- `lists.test.ts` — `refresh()`-throws regression for all three actions
  (Phase 3).

### Integration Tests:

- `organizer-view.integration.test.ts` — real-stack pre-reveal invariant
  (Phase 2).

### pgTAP:

- `03_claims.test.sql` — cross-owner rejection for all three write RPCs
  (Phase 4).

### Manual Testing Steps:

1. Run `pnpm dev:local` and load an organizer's event page before and after
   reveal — confirm no visual/behavioral change from the Phase 1 refactor.
2. Claim an item as a guest and confirm the success toast/status update
   still appears (Phase 3 happy path unchanged).
3. With the local stack running, confirm `pnpm test:integration` actually
   executes (not skipped) the new integration test.

## Performance Considerations

None — this phase adds test coverage and one synchronous `try/catch`; no
new runtime code path with a performance profile.

## Migration Notes

Not applicable — no schema or data changes; `03_claims.test.sql` runs inside
a transaction that's rolled back (`begin; ... rollback;`), same as today.

## References

- Related research: `context/changes/testing-organizer-blindness-claim-integrity/research.md`
- Source risk map: `context/foundation/test-plan.md` §2 (rows #1–#3), §3 (row 1)
- Similar implementation: `src/lib/lists/claim-race.integration.test.ts` (integration pattern), `src/lib/lists/owned-events.ts:105-176` (discriminated-union shape)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract organizer-view composition + unit coverage

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — a7c959d
- [x] 1.2 Type checking passes: `pnpm typecheck` — a7c959d
- [x] 1.3 Linting passes: `pnpm lint` — a7c959d

#### Manual

- [x] 1.4 Organizer page renders correctly pre- and post-reveal in local dev — a7c959d

### Phase 2: Prove the pre-reveal invariant end-to-end (integration)

#### Automated

- [x] 2.1 Integration test passes: `pnpm test:integration` — 9e3e2f4
- [x] 2.2 Type checking passes: `pnpm typecheck` — 9e3e2f4
- [x] 2.3 Linting passes: `pnpm lint` — 9e3e2f4

#### Manual

- [x] 2.4 Confirm the integration test actually runs (not skipped) locally — 9e3e2f4

### Phase 3: Guard refresh() in all three Server Actions

#### Automated

- [x] 3.1 Unit tests pass: `pnpm test` — ca1cf1c
- [x] 3.2 Type checking passes: `pnpm typecheck` — ca1cf1c
- [x] 3.3 Linting passes: `pnpm lint` — ca1cf1c

#### Manual

- [x] 3.4 Claim happy path unchanged in local dev (toast + status update) — ca1cf1c

### Phase 4: Cross-owner pgTAP coverage

#### Automated

- [x] 4.1 pgTAP suite passes: `pnpm test:db` — b47fd11

### Phase 5: Cookbook + lessons sync

#### Manual

- [x] 5.1 test-plan.md §6.2/§6.6 and lessons.md read correctly on review
