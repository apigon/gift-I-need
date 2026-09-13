# Post-Event Reveal Implementation Plan

## Overview

Wire the already-built reveal/claim data layer into the UI so the organizer can see full claim status after the reveal opens, either party (claimer or organizer) can mark an item "given," and the organizer can unlock the reveal early from `event_date + 1`. This is the S-05 roadmap slice — the data layer (RLS, RPCs, error vocabulary) shipped as part of `surprise-rule-data-contract` (F-02); this change is purely the application layer on top of it.

## Current State Analysis

The backend contract for this slice is 100% built and independently tested:

- `private.claim_item`, `private.mark_given`, `private.unlock_event`, `private.reveal_open`, `private.get_shared_event`, `private.get_shared_items` all exist (`supabase/migrations/20260911211956_surprise_rule_schema.sql`), each with a `public` SECURITY INVOKER wrapper granted to the right roles.
- `supabase/tests/03_claims.test.sql` and `04_shared_list.test.sql` already prove every edge case at the RPC level: repeat-mark no-op, repeat-unlock no-op, `not_revealed`/`not_claimed`/`not_permitted`/`unlock_too_early`/`event_not_found`, claimer identity (`claimer_id`, `given_by`) never exposed, and — critically — that an **owner calling `get_shared_items` with their own token** after the reveal gets real `available`/`given`/`taken` status and never `'mine'` (`04_shared_list.test.sql:77-83`). That is exactly the read path this plan reuses on the organizer's own page, so no new pgTAP coverage is needed for RPC authorization.
- `src/lib/lists/shared-list.ts` already exports `markGiven(itemId)` and `unlockEvent(eventId)`, wired to the RPCs — nothing in the app calls them yet.
- `src/lib/lists/errors.ts`'s `ListErrorCode`/`mapRpcError` already cover every error these RPCs raise.
- `StatusBadge`/`BadgeStatus` (`src/components/status-badge/status-badge.tsx`) already has a styled `"given"` variant.

What's missing is entirely UI and Server Actions, on two existing pages:

- `src/app/events/[id]/page.tsx` (organizer) reads items via `getOwnedEvent` (`src/lib/lists/owned-events.ts`), a **direct table query** that structurally cannot see claim status (`public.claims` has zero grants to any API role). It has no concept of status today, and its `OwnedEvent` type/select list doesn't even carry `unlockable_at`.
- `src/app/lists/[token]/page.tsx` (guest) already reads status via `getSharedList` (`get_shared_event` + `get_shared_items`), but `SharedItemList` has no interactive controls and doesn't receive `event.revealOpen` at all — it can't yet tell "claimed, revealed" from "claimed, not yet revealed."

### Key Discoveries:

- The owner-reads-own-token-after-reveal path is already pgTAP-proven (`supabase/tests/04_shared_list.test.sql:77-83`) — this plan's new automated coverage targets the untested **application-layer** composition (merging `getOwnedEvent` + `getSharedList` results), not RPC authorization.
- A guest can see `status: 'mine'`/`'taken'` **before** the reveal (only the organizer is blinded pre-reveal) — `mark_given` still raises `not_revealed` server-side in that window, so the UI gate for the "Mark as given" button must check `event.revealOpen`, not just `status`, or it will render a button that always fails.
- Once `revealOpen` is true, `items_insert_owner`'s RLS (`not private.reveal_open(event_id)`) makes the item set immutable — merging `getOwnedEvent` items with `getSharedList` items by `id` is race-free because no insert/delete can happen between the two reads.
- An organizer can never see `status: 'mine'` (`owner_cannot_claim` blocks self-claims) — so the organizer's item view only ever renders `'available' | 'taken' | 'given'`.
- `getOwnedEvent`'s current select list (`owned-events.ts:116`) omits `unlockable_at`, needed to gate the manual-unlock control's visibility.
- No `*.test.tsx` files exist anywhere in `src/`; `vitest.config.ts` runs tests in Node, not jsdom. This codebase tests logic (`.test.ts`) and leaves UI verification to manual testing — this plan follows that convention rather than introducing component-render tests.

## Desired End State

- Once an event's reveal is open (auto at `event_date + 2` in the event's timezone, or manually unlocked from `event_date + 1`), the organizer's `/events/[id]` page shows each item's real claim status (`available`/`taken`/`given`) via `StatusBadge`, still never a claimer's identity.
- From `event_date + 1` until the reveal opens, the organizer sees an "Unlock now" button on `/events/[id]`; clicking it opens the reveal immediately.
- Once the reveal is open, both the claiming guest (on `/lists/[token]`, for their own `'mine'` item) and the organizer (on `/events/[id]`, for any `'taken'` item) see a "Mark as given" button; whichever clicks first wins, the other's click becomes a no-op that still shows success.
- Verify via: `pnpm test` (new + existing unit suites pass), `pnpm typecheck`, `pnpm lint`, and the manual walkthroughs in each phase (claims seeded via direct RPC call, per What We're NOT Doing below, since claim-gift-item's UI is a separate, unplanned change).

## What We're NOT Doing

- No new migration, table, RLS policy, or RPC — the full backend contract already exists and is tested.
- No claim-button UI on `/lists/[token]` — that's `claim-gift-item` (S-03), a separate, currently-unplanned change. Manual verification here seeds a claim by calling `claim_item` directly against the local stack (mirrors the existing pattern in `src/lib/lists/claim-race.integration.test.ts`), not by clicking through a claim flow.
- No confirmation modal before manual unlock, and no separate "you can unlock early" banner — the unlock button's presence, once eligible, is the only signal (per plan interview).
- No new pgTAP test — the owner-reads-own-token-after-reveal RPC path is already covered by `04_shared_list.test.sql:77-83`.
- No event lifecycle changes (archive/delete after reveal) — open roadmap question, explicitly out of scope for this slice.
- No realtime/websocket status updates — status is read fresh on every page load (Server Components, `connection()`-gated, never cached), same posture as the existing shared-list/owned-events reads.

## Implementation Approach

Reuse the vetted `get_shared_*` RPC path for every claim-status read, on both sides of the app — never touch `public.claims` directly, and never re-derive the organizer-blindness predicate in application code. The organizer's own page composes two independent reads (`getOwnedEvent` for owner-only chrome fields, `getSharedList` for status) rather than a new RPC, so the one place that decides "what does the organizer get to see" stays exactly where it already lives and is already tested: `private.get_shared_items`.

## Phase 1: Data & Server Action Foundation

### Overview

Extend the owner's data-fetch layer with `unlockable_at`, add a pure function that merges `getOwnedEvent`'s items with `getSharedList`'s status overlay, and add the two new Server Actions (`markGiven`, `unlockEvent`) that the UI phases will call. No UI changes in this phase.

### Changes Required:

#### 1. `owned-events.ts` — expose `unlockable_at`

**File**: `src/lib/lists/owned-events.ts`

**Intent**: The manual-unlock control (Phase 3) needs to know when it becomes eligible. Mirror the existing `revealOpen` computation (same file, `getOwnedEvent`) rather than a second RPC round-trip.

**Contract**: Add `unlockable_at` to the `events` select list. Add `unlockable: boolean` to `OwnedEvent` (`src/lib/lists/types.ts`), computed the same way `revealOpen` already is — `Date.now() >= new Date(eventRow.unlockable_at).getTime()` — and only meaningful when `revealOpen` is false. Extend `owned-events.test.ts`'s `eventWith`/assertions to cover `unlockable` the same way it covers `revealOpen` (false before `unlockable_at`, true at and after it — inclusive boundary, matching `private.unlock_event`'s `now() < v_unlockable_at` check).

#### 2. Status-overlay merge helper

**File**: `src/lib/lists/reveal-status.ts` (new)

**Intent**: A small, pure, independently-testable function that overlays `SharedItem.status` onto `OwnedItem[]` by `id`, for the organizer's post-reveal view. Kept separate from `owned-events.ts`/`shared-list.ts` because it depends on both modules' types but calls neither — it's pure data composition, easiest to unit-test in isolation.

**Contract**: `mergeOwnedItemsWithStatus(ownedItems: OwnedItem[], sharedItems: SharedItem[] | null): OwnedItemWithStatus[]`, where `OwnedItemWithStatus = OwnedItem & { status: ItemStatus | null }`. When `sharedItems` is `null` (the overlay fetch failed or wasn't attempted), every item gets `status: null` — Phase 3 uses this same `null` to decide whether to render the "couldn't load status" note vs. simply "pre-reveal, nothing to show." Matching is by `id`; an owned item with no corresponding shared item (should not happen once the item set is frozen post-reveal, per the Key Discoveries note) is defensively treated as `status: null` rather than thrown. Add `reveal-status.test.ts` covering: empty overlay, full match, and a missing-match id.

#### 3. `markGiven` / `unlockEvent` Server Actions

**File**: `src/app/actions/lists.ts` (new)

**Intent**: Thin `"use server"` wrappers around `shared-list.ts`'s `markGiven`/`unlockEvent`, shaped for `useActionState` the same way `updateItem` (`src/app/actions/events.ts`) wraps `owned-events.ts`. New file rather than adding to `events.ts`: these actions serve both the guest and organizer UI (Phase 2 and 3), mirroring the existing `shared-list.ts` vs `owned-events.ts` split at the lib layer — `events.ts` stays organizer-only (owned-events.ts-backed) actions.

**Contract**: Export `markGivenAction` and `unlockEventAction` — not `markGiven`/`unlockEvent`, which would collide with the same-named functions imported from `shared-list.ts` inside this file (a duplicate-identifier compile error). Alias those imports the same way `events.ts` already aliases its `owned-events.ts` imports (`addItem as insertItem`, `updateItem as updateItemRow`): `import { markGiven as markGivenRpc, unlockEvent as unlockEventRpc } from "@/lib/lists/shared-list"`. Both actions take `(itemId | eventId, _prevState: FormState<never>, _formData: FormData)` and return `FormState<never>` (no field errors — neither action has form fields), reusing `initialFormState`/`FormState` from `src/lib/forms/form-state.ts`. On success, call `refresh()` (next/cache) so the invoking Server Component re-runs its data fetch — same contract `addItem`/`updateItem` already use. On failure, return `{ status: "error", message }`, choosing a specific message for the couple of codes a user can act on (`unlock_too_early` — "Try again after it opens"; everything else generic), mirroring `EVENT_ERROR_MESSAGES` in `events.ts`. `not_claimed`/`not_permitted`/`not_revealed` on `markGiven`, and a repeat `unlock_event` call, all collapse to the generic message — none are user-actionable copy, and a repeat click racing another party's successful mark should read as "Something went wrong, try again" only if it's a genuine error; a no-op success (second mark by the same allowed party) is NOT an error at the RPC level (it just updates 0 rows and returns success), so no special-casing is needed there.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- N/A — no UI in this phase. Verified entirely by the automated tests above.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Guest-Side Mark-Given UI

### Overview

The claiming guest can mark their own item given, once the reveal is open, from `/lists/[token]`.

### Changes Required:

#### 1. Pass `revealOpen` into `SharedItemList`

**File**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx`

**Intent**: The component currently only receives `items`; it needs `event.revealOpen` (already available in `page.tsx`) to decide whether a `'mine'` item's mark-given button should render — `status === 'mine'` alone is not sufficient, since a guest can be `'mine'` pre-reveal too (Key Discoveries).

**Contract**: Add a `revealOpen: boolean` prop, threaded from `SharedListPage` (`src/app/lists/[token]/page.tsx`). Render the mark-given control (item 2 below) only when `revealOpen && item.status === 'mine'`.

#### 2. Mark-given control

**File**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx` (or a small extracted child if the diff gets noisy — implementer's call)

**Intent**: A client-side control bound to the new `markGiven` action (Phase 1.3), following `EditItemModal`'s `useActionState` + `Button pending` + `notify.success` pattern — the toast supplements the `StatusBadge` flip from `'mine'` to `'given'` after `refresh()`, per CLAUDE.md's toast rule (never the only confirmation).

**Contract**: `useActionState(markGivenAction.bind(null, item.id), initialFormState)` (Phase 1.3's `markGivenAction`); on `state.status === "idle"` after a non-initial resolution, `notify.success("Marked as given")`. On `state.status === "error"`, show `state.message` (reuse the small inline-error pattern from `EditItemModal`, scoped to this item's row rather than the whole page). `SharedItemList` itself must become (or delegate to) a client component for this — it currently is not; the smallest change is extracting a `MarkGivenButton` client child so the list itself can stay server-rendered where possible. (Implementer's call whether that extraction is worth it vs. making the whole list client — given the list is small and StatusBadge/notify are already client-safe, either is acceptable; prefer the smaller client boundary.)

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Seed a claim directly (local stack running, `supabase start`): sign in as a guest via the app, then call `claim_item` for an item on an event with `event_date` in the past two days (or time-travel `revealed_at`/`auto_reveal_at` in the local DB) so the reveal is already open and the item is `'mine'`.
- Visit `/lists/[token]` as that guest: the item shows `StatusBadge status="mine"` and a "Mark as given" button.
- Click it: button shows pending state, then the badge flips to `given` and a success toast appears.
- Click it again (or have the organizer mark it given first, then this guest revisits): no error, badge already shows `given`, no duplicate button.
- Visit the same event pre-reveal as a guest who has claimed an item: `'mine'` badge shows, no mark-given button.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Organizer-Side Status Overlay, Mark-Given & Manual Unlock

### Overview

The organizer's own event page shows real claim status once revealed, lets the organizer mark an item given, and exposes a manual "unlock now" control from `event_date + 1`.

### Changes Required:

#### 1. Fetch the status overlay in `page.tsx`

**File**: `src/app/events/[id]/page.tsx`

**Intent**: When `event.revealOpen`, additionally call `getSharedList(event.shareToken)` and merge its items with `getOwnedEvent`'s via `mergeOwnedItemsWithStatus` (Phase 1.2). Any result with `kind !== "ok"` — `"error"` or the structurally-unreachable-but-still-typed `"not_found"` (the owner is reading their own already-validated `share_token`) — degrades gracefully the same way: pass `sharedItems: null` into the merge (all statuses `null`) rather than failing the whole page, per the plan interview's graceful-degradation decision. Pre-reveal, skip the extra fetch entirely (status would only ever come back `null` anyway — see `private.get_shared_items`'s owner branch).

**Contract**: `ItemList` (item 2 below) now receives `OwnedItemWithStatus[]` instead of `OwnedItem[]`, plus a `statusUnavailable: boolean` flag (true only when the overlay fetch was attempted and failed) so it can render the "couldn't load claim status" inline note distinctly from "pre-reveal, nothing to show."

#### 2. Render status + mark-given in `ItemList`

**File**: `src/app/events/[id]/components/item-list/item-list.tsx`

**Intent**: Once revealed, replace the (now-hidden) Edit button with a `StatusBadge` for each item's status, plus a mark-given control (reusing the same pattern as Phase 2.2) when `status === 'taken'`. `'available'` items get only the badge, no button (nothing to mark). `'given'` items get only the badge. (`'mine'` never occurs for the organizer — Key Discoveries.)

**Contract**: New props `revealOpen: boolean` (already present) now actually drives badge/button rendering, not just Edit-button hiding; `items: OwnedItemWithStatus[]`; `statusUnavailable: boolean`. When `statusUnavailable`, render a small muted inline note ("Couldn't load claim status — try refreshing") instead of a badge, per item, but keep titles/notes/edit-hiding logic unchanged.

#### 3. Manual unlock control

**File**: `src/app/events/[id]/components/unlock-control/unlock-control.tsx` (new), wired into `page.tsx`

**Intent**: A plain button, visible only when `event.unlockable && !event.revealOpen` (Phase 1.1's new field), bound to the new `unlockEventAction` (Phase 1.3). No confirmation dialog (per plan interview). Follows the same `useActionState` + `Button pending` + `notify.success` pattern as the mark-given controls; on success, `refresh()` re-runs `getOwnedEvent` and the page's `revealOpen` flips, which in turn triggers the status-overlay fetch on next render.

**Contract**: Rendered in `page.tsx` alongside the existing `Gift ideas` heading area, gated by `event.unlockable && !event.revealOpen`. Button label "Unlock now" (or similar); `pendingLabel="Unlocking…"`; toast "Reveal unlocked" on success. Also update `src/app/events/[id]/components/index.ts` to add `export { UnlockControl } from "./unlock-control/unlock-control";` — the barrel that `page.tsx` already imports the rest of this directory's components through.

**Addendum (post-impl-review, 2026-09-13)**: Shipped as `src/app/events/[id]/components/reveal-control/reveal-control.tsx`, component `RevealControl`, barrel export `RevealControl` — not `unlock-control`/`UnlockControl`. Copy shipped as "Open the reveal now" / `pendingLabel="Opening…"` / toast "Reveal opened", not "Unlock now" / "Unlocking…" / "Reveal unlocked". Deliberate: a new organizer seeing "Unlock" would plausibly read it as "click this before sharing the link to let guests claim," not "reveal claim status early" — the opposite of what the button does. Gating logic (`event.unlockable && !event.revealOpen`) is unchanged from the contract above.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- Create an event with `event_date` set to today (local stack): confirm no unlock button appears yet (before `event_date + 1`).
- Time-travel or wait until `event_date + 1` (or directly patch `unlockable_at` in the local DB to the past, matching how `03_claims.test.sql` time-travels `unlockable_at`/`auto_reveal_at`): reload `/events/[id]` as the owner — "Unlock now" appears.
- Seed a claim on one item (direct `claim_item` call, per Phase 2's manual steps) and leave another item unclaimed.
- Click "Unlock now": button shows pending, then the page shows real statuses — the claimed item as `taken`, the unclaimed one as `available` with no button, no `Edit` buttons anywhere, and the unlock button is gone.
- Click "Mark as given" on the `taken` item as the organizer: badge flips to `given`, toast confirms, button disappears.
- Re-run `getSharedList` for the same event with a forced RPC error (e.g. temporarily revoke `authenticated`'s execute on `get_shared_items` in a local psql session, or stub the call in a manual code edit) to confirm the page still renders items/titles with the "couldn't load claim status" note instead of a blank page — then restore and confirm it recovers on refresh.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `owned-events.test.ts`: extend for `unlockable` (mirroring the existing `revealOpen` boundary tests — false before, true at and after `unlockable_at`).
- `reveal-status.test.ts` (new): `mergeOwnedItemsWithStatus` — empty overlay (`null`) yields all-`null` statuses; full id match overlays correctly; a shared item missing from the owned set (or vice versa) doesn't throw.
- New Server Action tests for `markGiven`/`unlockEvent` in `src/app/actions/lists.ts` (or co-located `.test.ts`), following `events.test.ts`'s (if present) or `owned-events.test.ts`'s mocking pattern for the underlying `shared-list.ts` calls — mock `markGiven`/`unlockEvent` from `shared-list.ts`, assert `FormState` mapping for success and each relevant error code.

### Integration Tests:

- None added. The one genuinely new code path (owner composing two reads for their own status overlay) is exercised by the Phase 3 manual walkthrough; its RPC-level authorization is already proven by `04_shared_list.test.sql:77-83`. `mark_given` and `unlock_event` need no multi-connection race test either — unlike `claim_item` (whose race `claim-race.integration.test.ts` does cover, via a unique-index collision), each does its write as a single `UPDATE ... WHERE <flag> IS NULL` statement, which Postgres serializes atomically via row-level locking, so "first caller wins, second is a no-op" holds by construction.

### Manual Testing Steps:

See each phase's Manual Verification above — together they cover: guest marks own item given (pre- and post-reveal gating), organizer marks a claimed item given, organizer unlocks early, unclaimed items render correctly, and the status-overlay failure degrades gracefully.

## Performance Considerations

The organizer's page now issues up to two extra RPC calls (`get_shared_event`, `get_shared_items`) on every load once revealed, alongside the existing `getOwnedEvent` reads — all four run in parallel-friendly `Promise.all` groups (two existing, two new), not serially. No caching is introduced (consistent with the project-wide no-cache rule for list reads) since claim/given state must always be fresh.

## Migration Notes

None — no schema or data changes.

## References

- Data contract plan: `context/changes/surprise-rule-data-contract/plan.md`
- RPCs: `supabase/migrations/20260911211956_surprise_rule_schema.sql`, `supabase/migrations/20260911233636_single_reveal_gate_and_policy_subplan.sql`
- `unlockable_at` column grant (needed by Phase 1.1): `supabase/migrations/20260911231857_column_scoped_select.sql`
- Existing service layer: `src/lib/lists/shared-list.ts`, `src/lib/lists/owned-events.ts`
- Existing action pattern: `src/app/actions/events.ts` (`updateItem`), `src/app/events/[id]/components/edit-item-modal/edit-item-modal.tsx` (`useActionState` + `Button pending` + `notify`)
- pgTAP coverage already proving the reused read path: `supabase/tests/04_shared_list.test.sql:77-83`
- Roadmap slice: `context/foundation/roadmap.md` (S-05)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data & Server Action Foundation

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 10c9537
- [x] 1.2 Type checking passes: `pnpm typecheck` — 10c9537
- [x] 1.3 Linting passes: `pnpm lint` — 10c9537

### Phase 2: Guest-Side Mark-Given UI

#### Automated

- [x] 2.1 Unit tests pass: `pnpm test` — 8932999
- [x] 2.2 Type checking passes: `pnpm typecheck` — 8932999
- [x] 2.3 Linting passes: `pnpm lint` — 8932999

#### Manual

- [x] 2.4 Seeded 'mine' item post-reveal shows a Mark as given button — 8932999
- [x] 2.5 Clicking it shows pending state, then flips the badge to given with a success toast — 8932999
- [x] 2.6 Repeat click / already-given item shows no error and no duplicate button — 8932999
- [x] 2.7 Pre-reveal 'mine' item shows badge but no Mark as given button — 8932999

### Phase 3: Organizer-Side Status Overlay, Mark-Given & Manual Unlock

#### Automated

- [x] 3.1 Unit tests pass: `pnpm test` — e1fa0f9
- [x] 3.2 Type checking passes: `pnpm typecheck` — e1fa0f9
- [x] 3.3 Linting passes: `pnpm lint` — e1fa0f9
- [x] 3.4 Production build succeeds: `pnpm build` — e1fa0f9

#### Manual

- [x] 3.5 No unlock button before event_date + 1 — e1fa0f9
- [x] 3.6 Unlock button appears at/after unlockable_at and successfully unlocks — e1fa0f9
- [x] 3.7 Post-unlock: real statuses shown (taken/available), no Edit buttons, unlock button gone — e1fa0f9
- [x] 3.8 Organizer marks a taken item given; badge flips, toast confirms — e1fa0f9
- [x] 3.9 Status-overlay RPC failure degrades gracefully (titles still render, inline note shown) and recovers on refresh — e1fa0f9
