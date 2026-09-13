# Claim Gift Item Implementation Plan

## Overview

Wire a "Claim" action onto the shared gift-list page so a signed-in guest can claim one unclaimed item. The data-layer contract — the atomic single-claim constraint, the `claim_item` RPC, RLS, and the race-loser error mapping — was already built and locked by tests in F-02 (`surprise-rule-data-contract`). This plan adds only what's missing: a Server Action wrapping the existing DAL call, and the client-side Claim button UI with its confirmation and error-handling UX.

## Current State Analysis

- **Schema/RPC (done, F-02)**: `public.claims.item_id uuid not null unique` (`supabase/migrations/20260911211956_surprise_rule_schema.sql:82-105`) is the entire race guarantee — a race loser always gets Postgres `23505`, no check-then-insert window. `private.claim_item(p_item_id)` (same file, lines 277-327) checks auth → item exists → **owner exclusion** → reveal-gate (`claims_closed`) → insert, in that deliberate order so an owner's rejection can never be used as an oracle for whether an item is taken.
- **Read RPC (done, F-02)**: `private.get_shared_items` (`supabase/migrations/20260911233636_single_reveal_gate_and_policy_subplan.sql:59-92`) derives `status` per viewer: `null` for a signed-out visitor, `null` for the owner pre-reveal, `'available'` / `'taken'` / `'mine'` / `'given'` otherwise.
- **DAL (done, untested)**: `src/lib/lists/shared-list.ts:69-78` already exports `claimItem(itemId): Promise<ListResult>`, calling `supabase.rpc("claim_item", ...)` and mapping any error through `mapRpcError` (`src/lib/lists/errors.ts:43-57`, `23505` → `already_taken`, `42501` → `not_authenticated`, `P0001` → the raised message). Zero call sites and zero unit tests exist for it today.
- **Tests already locking the guarantee (F-02)**: `supabase/tests/03_claims.test.sql` (single-claim race, owner exclusion, RLS denial) and `src/lib/lists/claim-race.integration.test.ts` (5 concurrent real clients, exactly 1 wins, 4 losers map to `already_taken`). This slice does not need to add new coverage for the race itself.
- **UI (missing)**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx:20` renders `<StatusBadge status={item.status} />` when `item.status !== null`, but nothing else — no Claim button, no Server Action, no client interactivity anywhere on this page.

### Key Discoveries:

- `src/app/actions/events.ts` establishes the exact Server Action shape to reuse: `(prevState, formData) => Promise<FormState<...>>`, `refresh()` from `next/cache` after a successful/relevant mutation (Server Actions do not auto-rerender the invoking Server Component), never `redirect()` inside try/catch.
- `src/app/events/[id]/components/edit-item-modal/edit-item-modal.tsx` is the closest existing precedent: `Modal` + `useActionState` + a per-item action bound via `.bind(null, item.id)` + `notify.success` fired from a `useEffect` keyed on the action's resolved state, closing the modal on success. `claimItemAction` needs no form fields, so the `<form>` body is just Cancel/Confirm buttons — everything else about the pattern carries over unchanged.
- `src/lib/forms/form-state.ts:18` already exports `initialFormState: FormState<never>` — exactly the shape a no-field action needs for its "idle" case.
- `Button` (`src/components/button/button.tsx:12-48`) already supports `pending`/`pendingLabel`, and `StatusBadge` (`src/components/status-badge/status-badge.tsx`) already has an `"mine"` variant ("Claimed by you") — no new design-system primitives are needed.
- `src/app/lists/[token]/components/visibility-banner/visibility-banner.tsx:26` already uses the `` `/login?next=/lists/${token}` `` pattern for a signed-out guest — the same pattern this plan reuses for a guest whose session lapses mid-page.
- A signed-out visitor always gets `status: null` for every item (never `"available"`), so the Claim button never renders for them at all — the existing `VisibilityBanner` "guest_signed_out" banner already covers that PRD acceptance criterion; no separate gating is needed in the new component.

## Desired End State

A signed-in guest can click "Claim" on an available item, confirm in a modal, and see it flip to a "Claimed by you" badge with a success toast, typically within about a second. Other guests see it as "Taken" the next time they load or refresh the page. A guest who loses a claim race gets a clear "already claimed" message and the item's badge updates to reflect reality without a manual reload. A guest whose session lapses mid-page is sent to sign in and returned to the same list. The organizer's own pre-reveal view remains completely blind to claim status; if the organizer encounters their own unclaimed item after the reveal has opened, attempting to claim it fails gracefully with a clear message and no state change.

Verify by: the full automated suite (unit + pgTAP + integration) green, and manually walking every scenario in the Phase 2 and Phase 3 checklists below.

## What We're NOT Doing

- Unclaiming an item (FR-012, parked — claiming stays irreversible in v1).
- Warning on a guest claiming a second item in the same event (FR-013, parked).
- Any mark-as-given or post-event reveal UI (FR-010/FR-011 — `post-event-reveal`/S-05's scope).
- A dashboard of organized/attended events (FR-014, parked).
- Any live-push or polling mechanism so idle viewers see a claim without reloading — status updates rely on the next page load/refresh.
- Optimistic client-side state updates — the UI waits for the server response before flipping the badge; only the pending spinner is instant.
- Any change to `claim_item`, the schema, or RLS policies — this plan only calls the existing, tested contract.

## Implementation Approach

Reuse the `EditItemModal`/`updateItem` pattern exactly: a client component wraps `Modal` + `useActionState`, driven by a new per-item-bound Server Action. Because `claimItem` takes no form fields, the action ignores `formData` entirely — the pattern is otherwise identical, so no new interaction pattern is introduced to the codebase. The new `ClaimButton` client component is rendered conditionally from inside the still-server-rendered `SharedItemList` (only when `item.status === "available"`) rather than promoting the whole list to `"use client"` — unlike S-04's `ItemList`, this feature needs no shared state across items, so keeping the list itself server-rendered is simpler and keeps more of the page on the server.

## Critical Implementation Details

**State sequencing — keep the modal open and pending until the server responds.** The Confirm button must stay in its `pending` state (and the modal must stay open) for the full round trip to `claimItemAction`, not close optimistically on click. `Modal` (`src/components/modal/modal.tsx:11-18`) reconciles its native `<dialog>` open state imperatively against the `open` prop and documents that `onClose` must stay idempotent — closing early and then closing again when the action resolves risks a double-fire and would show the guest a closed modal while a claim is still in flight (misread as either "done" or "cancelled").

**Edge case — an organizer can see "available" on their own list after the reveal opens.** Pre-reveal, `get_shared_items` forces `status: null` for the owner (`e.owner_id = auth.uid() and not private.reveal_open(e.id) then null`), so `ClaimButton` never renders for them. Once the reveal opens, that condition is false, and an unclaimed item on the organizer's *own* shared link falls through to `status: 'available'` — so the Claim button **will** render for the organizer in that state. `claim_item` deliberately checks ownership before the reveal gate (so the rejection can't be used to infer reveal state), which means this case always resolves to `owner_cannot_claim`, not `claims_closed`. The UI must treat this as a normal, expected error response (toast + no state change), not an unreachable case.

## Phase 1: Server Action + Test Coverage

### Overview

Add the Server Action that wraps the existing `claimItem` DAL call, and lock both it and the DAL function with unit tests, before any UI exists to exercise them manually.

### Changes Required:

#### 1. Claim Server Action

**File**: `src/app/actions/lists.ts` (new)

**Intent**: Wrap `claimItem` from `src/lib/lists/shared-list.ts` in a Server Action shaped for `useActionState`, bound per-item like `updateItem`. Map each `ListErrorCode` the RPC can realistically return to a guest-facing message, always calling `refresh()` afterward (success or failure) so the invoking Server Component re-fetches and the item's real status is reflected regardless of outcome.

**Contract**: `claimItemAction(itemId: string, prevState: ClaimFormState, formData: FormData): Promise<ClaimFormState>`, where `formData` is unused (no fields to parse) and:
```ts
type ClaimFormState =
  | { status: "idle" }
  | { status: "error"; code: ListErrorCode; message: string };
```
The `code` field (absent from the shared `FormState<T>` used by `createEvent`/`addItem`/`updateItem`) is what lets the client distinguish "redirect to sign-in" (`not_authenticated`) from "toast and stay" (every other error). Message copy: `already_taken` → "Someone else already claimed this gift.", `claims_closed` → "Claiming has closed for this event.", `owner_cannot_claim` → "You can't claim items on your own list.", `not_authenticated` → "Please sign in to claim this gift.", everything else → the same generic fallback string `events.ts` already uses.

#### 2. Unit tests for the DAL's `claimItem`

**File**: `src/lib/lists/shared-list.test.ts`

**Intent**: `claimItem` has zero coverage today. Add tests mirroring the existing `getSharedList` describe block's mocking style (`vi.mock` on `@/utils/supabase/server`).

**Contract**: Assert `claimItem(itemId)` calls `supabase.rpc("claim_item", { p_item_id: itemId })` exactly once; assert the ok path returns `{ ok: true }`; assert an RPC error (e.g. `{ code: "23505", message: "..." }`) returns `{ ok: false, code: "already_taken" }` via the real `mapRpcError` (do not re-mock error mapping — `errors.test.ts` already owns that logic in isolation).

#### 3. Unit tests for `claimItemAction`

**File**: `src/app/actions/lists.test.ts` (new)

**Intent**: This is the first Server Action in the codebase to get direct unit test coverage — `auth.ts`/`events.ts` have none. Follow the same mocking approach as `shared-list.test.ts`: mock `@/lib/lists/shared-list`'s `claimItem` and `next/cache`'s `refresh`.

**Contract**: Assert the success path calls `refresh()` and returns `{ status: "idle" }`; assert each error code (`already_taken`, `claims_closed`, `owner_cannot_claim`, `not_authenticated`, and one unmapped code) returns `{ status: "error", code, message }` with the correct copy from the map (or the generic fallback); assert `refresh()` is called in every case, not only on success.

### Success Criteria:

#### Automated Verification:

- Unit tests for `claimItem` pass: `pnpm test`
- Unit tests for `claimItemAction` pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- Review the error-message map against every `ListErrorCode` `claim_item` can realistically return (`already_taken`, `claims_closed`, `owner_cannot_claim`, `not_authenticated`) to confirm no path falls through to the generic message where a specific one exists

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual review was completed before proceeding to the next phase.

---

## Phase 2: Claim UI

### Overview

Add the Claim button and its confirmation modal to the shared-list page, wired to `claimItemAction`, handling every error-code outcome including the owner-post-reveal edge case.

### Changes Required:

#### 1. `ClaimButton` client component

**File**: `src/app/lists/[token]/components/claim-button/claim-button.tsx` (new)

**Intent**: A per-item Claim button that opens a `Modal` asking the guest to confirm before claiming (claiming is irreversible in v1). Mirrors `EditItemModal`'s structure: `useActionState(claimItemAction.bind(null, item.id), initialFormState)`, a `useEffect` on the resolved state that fires `notify.success`/`notify.error` and closes the modal, `Button pending pendingLabel="Claiming…"` on the Confirm button.

**Contract**: `ClaimButton({ itemId, itemTitle, token }: { itemId: string; itemTitle: string; token: string })`. On `state.status === "idle"` after a real submission (matching `EditItemModal`'s `state !== INITIAL_STATE` idiom): `notify.success("Claimed!")`, close the modal. On `state.status === "error"`: if `state.code === "not_authenticated"`, `notify.error(state.message)` then navigate to `` `/login?next=/lists/${token}` `` (client-side, via `useRouter` from `next/navigation`); for every other code, `notify.error(state.message)` and close the modal — no other special-casing, since `refresh()` inside the action has already brought the item's real status back for the next render. Modal title: e.g. `` `Claim "${itemTitle}"?` ``; body: a short confirmation sentence plus Cancel/Confirm buttons (Cancel calls `onClose` directly with no request sent, matching `EditItemModal`'s Cancel button).

#### 2. Wire `ClaimButton` into the shared item list

**File**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx`

**Intent**: Render `<ClaimButton .../>` next to the `StatusBadge` only when `item.status === "available"` — for every other status (`taken`, `mine`, `given`, or `null`), render nothing extra, exactly as today.

**Contract**: `SharedItemList` gains a `token: string` prop (needed by `ClaimButton` for the sign-in redirect) and passes it through; the component itself stays a plain Server Component (no `"use client"` needed at this level — `ClaimButton` is the client boundary).

#### 3. Pass `token` from the page

**File**: `src/app/lists/[token]/page.tsx`

**Intent**: Thread the already-in-scope `token` variable into `<SharedItemList items={items} token={token} />` (it's already destructured at line 14 for `VisibilityBanner`).

**Contract**: One added prop on an existing call site; no other change.

#### 4. Barrel export

**File**: `src/app/lists/[token]/components/index.ts`

**Intent**: Re-export `ClaimButton` alongside the existing two components, per the barrel convention.

**Contract**: `export { ClaimButton } from "./claim-button/claim-button";`

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Full unit test suite still passes: `pnpm test`

#### Manual Verification:

- As a signed-in guest, opening the shared list and clicking "Claim" on an available item opens the confirmation modal; clicking outside the modal or Cancel closes it and sends no request
- Clicking Confirm shows the Confirm button's pending state, then the item's badge flips to "Claimed by you", the Claim button disappears, and a success toast appears
- Reloading the page shows the same "Claimed by you" state (confirms the claim persisted server-side, not just client state)
- Viewing the same list as a different signed-in guest (or a second browser session) shows the claimed item as "Taken" with no Claim button
- After the reveal has opened for a test event (manually unlock it), signing in as the organizer and opening their own shared link: an unclaimed item shows "Available" with a Claim button; clicking Confirm surfaces "You can't claim items on your own list" and the item stays "Available" with no state change
- Simulating a lapsed session (e.g. sign out in another tab, then Confirm a pending claim in the original tab) redirects to `/login?next=/lists/[token]` with an explanatory toast

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Regression & Edge-Case Verification

### Overview

Confirm this slice hasn't regressed any of F-02's guarantees — the surprise rule and the duplicate-claim guardrail are the highest-stakes invariants in the product (CLAUDE.md) — and walk through the race/latency/edge-case scenarios end to end with the real UI in place.

### Changes Required:

No source changes are expected in this phase. If a manual check below surfaces a real gap, fix it in the relevant Phase 1/2 file and re-run that phase's automated checks before returning here.

### Success Criteria:

#### Automated Verification:

- pgTAP suite still passes with no changes needed: `pnpm test:db` (needs `colima start` and `supabase start`)
- Concurrent-claim integration test still passes with no changes needed: `pnpm test:integration` (needs `colima start` and `supabase start`)
- Full suite clean end to end: `pnpm test`, `pnpm lint`, `pnpm typecheck`

#### Manual Verification:

- Two guests (two browser sessions) click Claim on the same item within the same second; the loser sees the "already claimed" toast and their view updates to "Taken" without a manual reload
- The claim completes within roughly a second under normal conditions, with no stuck or ambiguous pending state even under a throttled network (DevTools network throttling)
- After a guest has claimed an item, the organizer's pre-reveal view still shows zero claim status, claimer identity, or claim counts — spot-check this guardrail hasn't regressed
- A signed-out visitor never sees a Claim button anywhere on the shared list — only the existing sign-in prompt banner

**Implementation Note**: After completing this phase and all automated verification passes, this slice is complete — no further manual confirmation gate beyond the checks above.

---

## Testing Strategy

### Unit Tests:

- `claimItem` (DAL): RPC call shape, ok path, error-mapping pass-through
- `claimItemAction` (Server Action): success path calls `refresh()` and returns idle; every error code maps to the correct `{ status, code, message }`; `refresh()` fires on every path

### Integration Tests:

- No new integration test — the existing `claim-race.integration.test.ts` (5 concurrent clients, exactly 1 winner) already covers the guarantee this slice's UI sits on top of, and Phase 3 re-runs it to confirm no regression.

### Manual Testing Steps:

1. Claim an available item as a signed-in guest; confirm the full happy path (modal → pending → success toast → badge flip → persists across reload)
2. Attempt to claim as the organizer on their own list after the reveal has opened; confirm the `owner_cannot_claim` message and no state change
3. Force a claim race between two sessions; confirm the loser's toast and automatic badge update
4. Force a lapsed-session claim attempt; confirm the redirect to `/login?next=/lists/[token]`
5. Confirm a signed-out visitor never sees a Claim button

## Performance Considerations

None beyond the existing NFR (claim confirms within ~1s perceived latency) — a single RPC call plus one `refresh()`-triggered re-fetch, no new round trips or caching layers introduced.

## Migration Notes

None — no schema or data changes in this plan.

## References

- Data-layer contract: `context/changes/surprise-rule-data-contract/plan.md`, `context/changes/surprise-rule-data-contract/research.md` (not yet archived, but functionally complete — see its Progress section)
- Prior UI precedent: `context/archive/2026-09-12-edit-list-items/plan.md` (Modal + `useActionState` per-item action pattern)
- Prior UI precedent: `context/archive/2026-09-12-browse-shared-list/plan.md` (shared-list page structure, explicitly scoped claiming out as "S-03's job")
- `src/lib/lists/shared-list.ts:69-78` — existing `claimItem` DAL function this plan wraps
- `src/lib/lists/errors.ts:43-57` — existing `mapRpcError`, already includes `already_taken`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server Action + Test Coverage

#### Automated

- [ ] 1.1 Unit tests for `claimItem` pass
- [ ] 1.2 Unit tests for `claimItemAction` pass
- [ ] 1.3 Type checking passes
- [ ] 1.4 Linting passes

#### Manual

- [ ] 1.5 Error-message map reviewed against every realistic `ListErrorCode`

### Phase 2: Claim UI

#### Automated

- [ ] 2.1 Type checking passes
- [ ] 2.2 Linting passes
- [ ] 2.3 Full unit test suite passes

#### Manual

- [ ] 2.4 Modal opens on Claim; Cancel/outside-click sends no request
- [ ] 2.5 Confirm shows pending, then badge flips to "mine" + success toast, modal closes
- [ ] 2.6 Reload confirms server-persisted claim
- [ ] 2.7 Other guest sees "Taken", no Claim button
- [ ] 2.8 Post-reveal organizer sees Available + Claim button on own list; Confirm surfaces `owner_cannot_claim`, no state change
- [ ] 2.9 Lapsed session redirects to `/login?next=/lists/[token]` with toast

### Phase 3: Regression & Edge-Case Verification

#### Automated

- [ ] 3.1 `pnpm test:db` passes
- [ ] 3.2 `pnpm test:integration` passes
- [ ] 3.3 Full `pnpm test`, `pnpm lint`, `pnpm typecheck` clean

#### Manual

- [ ] 3.4 Two-session race: loser sees toast + auto-updates to "Taken" without manual reload
- [ ] 3.5 Claim completes within ~1s, no ambiguous pending state under throttled network
- [ ] 3.6 Organizer's pre-reveal view still shows zero claim info after a guest has claimed
- [ ] 3.7 Signed-out visitor never sees a Claim button
