# Browse Shared List Implementation Plan

## Overview

Ship the guest-facing route at `/lists/[token]` (S-02 on the roadmap). It reads through the already-built `getSharedList` DAL function, renders the event's gift ideas, and shows each item's per-viewer claim status — while explaining, in a viewer-appropriate way, the cases where status is intentionally hidden (an unauthenticated visitor, or the organizer before the reveal).

## Current State Analysis

F-02 (`surprise-rule-data-contract`) already shipped everything this slice needs at the data layer:

- `getSharedList(token)` (`src/lib/lists/shared-list.ts:17`) calls the `get_shared_event`/`get_shared_items` RPCs and returns a `SharedListResult` with three outcomes (`ok` / `not_found` / `error`).
- The RPCs (`supabase/migrations/20260911221653_shared_list_rpcs.sql`) already compute a per-viewer `status` server-side: `null` when `auth.uid() is null` (unauthenticated) **or** when the viewer is the owner and the reveal hasn't opened yet — the same branch, by design, so the app layer cannot and must not tell these two cases apart from the RPC output alone (it must use `event.isOwner` instead, see Key Discoveries).
- `SharedEvent`/`SharedItem`/`ItemStatus` types (`src/lib/lists/types.ts`) and `StatusBadge`/`BadgeStatus` (`src/components/status-badge/status-badge.tsx`) already align 1:1 — `ItemStatus` is type-asserted against `BadgeStatus`.
- The share URL shape already exists and is live: `events/[id]/page.tsx:54` builds `/lists/${event.shareToken}` and shows it to the organizer as "Share with your guests."

What's missing is entirely presentational: **no `src/app/lists/[token]/` route exists yet.** There is no app-side filtering to write — the organizer-blindness and single-claim invariants are already enforced at the RPC layer (CLAUDE.md's "enforce at the data layer" rule is already satisfied by F-02).

## Desired End State

Opening a valid share link:

- Always shows the event name and every item's title/notes/link/price range, regardless of auth state (FR-007).
- Shows a `StatusBadge` per item only when `item.status` is non-null; when the viewer is signed in as a non-owner, this is always the case (available/taken/mine/given).
- Shows exactly one page-level banner when appropriate, never a per-item explanation:
  - Organizer, pre-reveal: a Yoda-voiced notice (matching `not-found.tsx`'s tone) + a link back to `/events/[id]`.
  - Unauthenticated guest: a sign-in prompt linking to `/login?next=/lists/[token]`.
  - No banner when every item already carries a real status (authenticated non-owner, or organizer post-reveal).
- Handles an invalid/nonexistent token via the existing global `not-found.tsx`, and an RPC failure via a danger `Alert` — both mirroring `events/[id]/page.tsx`'s existing handling.
- An event with zero items shows guest-appropriate empty copy (no "add it below" — guests can't add items here).

Verify by running through the manual checklist in Phase 2 against a local Supabase stack with a seeded event in each of the four viewer states.

### Key Discoveries:

- **The organizer/guest distinction for a null status is derivable, not queryable.** Because `get_shared_items` only ever returns `status: null` for (a) an unauthenticated caller or (b) the owner pre-reveal, and `get_shared_event.is_owner` is `true` only when the caller is authenticated *and* owns the event, the page can tell the two null-status cases apart purely from `event.isOwner` — no separate `getUser()` call needed. See `src/lib/lists/shared-list.test.ts` for the shape this already locks in.
- **The banner condition should gate on "does any item actually have a hidden status," not just `isOwner`.** An organizer viewing their list *after* the reveal gets real statuses from the RPC (same as any guest) and needs no banner; gating purely on `isOwner` would show a stale "hidden" notice even when nothing is hidden. Also correctly suppresses the banner for a zero-item list, where there's nothing to explain.
- **Pattern to mirror**: `src/app/events/[id]/page.tsx` for the Server Component / `notFound()` / `Alert` structure, and `src/app/events/[id]/components/item-list/item-list.tsx` for the item-card layout (title/notes/link/price-range).
- **Test convention**: this repo has zero component tests (`vitest.config.ts` runs `environment: "node"`, includes only `src/**/*.test.ts`, no jsdom/RTL anywhere). Automated coverage for this slice is therefore a `.test.ts` file for the new pure banner-derivation logic, not rendered-component tests — consistent with every other `src/lib/lists/*.test.ts` file.

## What We're NOT Doing

- No claim button, disabled or otherwise — claiming is S-03 (`claim-gift-item`)'s scope entirely.
- No changes to the RPCs, migrations, or `getSharedList`/types — the data contract is already correct and tested.
- No page metadata / `generateMetadata` — the route keeps the app-default title.
- No redirect or route-level special-casing for the organizer — they see the same route, with the pre-reveal banner explaining their own blindness.
- No dashboard, no "my events" listing — out of scope per PRD Non-Goals / FR-014 (parked).

## Implementation Approach

Two small, sequential pieces: (1) a pure, unit-tested helper that decides which banner (if any) applies, plus the presentational components that consume it; (2) the route itself, wiring `getSharedList` into those components and handling the not-found/error/empty edge cases — mirroring `events/[id]/page.tsx` throughout so the two sibling routes stay visually and structurally consistent.

## Phase 1: Visibility logic and presentational components

### Overview

Add the pure banner-derivation helper and the two new components the route will assemble. No route yet — this phase is fully unit-testable in isolation.

### Changes Required:

#### 1. Visibility helper

**File**: `src/lib/lists/visibility.ts`

**Intent**: Given the event's `isOwner` flag and the item list, decide which single page-level banner (if any) applies, per Key Discoveries above. Deliberately scans `items` for `status === null` rather than reading `event.revealOpen` directly — `revealOpen` alone would show a stale organizer banner on a zero-item list, since it can't tell "reveal hasn't happened" apart from "nothing to hide." Do not "simplify" this to `!isOwner && !event.revealOpen` without re-adding an explicit `items.length > 0` guard.

**Contract**: `getVisibilityBanner(event: Pick<SharedEvent, "isOwner">, items: Pick<SharedItem, "status">[]): "organizer_hidden" | "guest_signed_out" | null`. Returns `"organizer_hidden"` when `event.isOwner` and at least one item has `status === null`; `"guest_signed_out"` when not `isOwner` and at least one item has `status === null`; otherwise `null`.

#### 2. Visibility helper tests

**File**: `src/lib/lists/visibility.test.ts`

**Intent**: Lock in the three branches plus the two edge cases called out in Key Discoveries (organizer post-reveal → no banner; zero items → no banner) so a future change to the derivation can't silently reintroduce a stale banner.

**Contract**: One `describe`/`it` per case, following the existing style in `shared-list.test.ts` (plain `expect().toEqual()`, no mocking needed since the function is pure).

#### 3. Visibility banner component

**File**: `src/app/lists/[token]/components/visibility-banner/visibility-banner.tsx`

**Intent**: Render the `Alert` (tone `"info"`) for `"organizer_hidden"` or `"guest_signed_out"`, or nothing for `null`. The organizer copy matches `not-found.tsx`'s Yoda voice and links to `/events/[id]` (needs the event's own `id`, already on `SharedEvent`); the guest copy is a plain sign-in prompt linking to `/login?next=/lists/[token]` (needs the token, since it's not on `SharedEvent`).

**Contract**: `VisibilityBanner({ kind, eventId, token }: { kind: ReturnType<typeof getVisibilityBanner>; eventId: string; token: string })`. `null` kind renders `null`.

#### 4. Shared item list component

**File**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx`

**Intent**: Render each item's title/notes/link/price-range (same card layout as `events/[id]`'s `ItemList`) plus a `StatusBadge` when `item.status` is non-null; render nothing where the badge would go otherwise (the page-level banner already explains why). Empty list renders the guest-appropriate copy decided in questioning ("No gift ideas here yet." — no call to action).

**Contract**: `SharedItemList({ items }: { items: SharedItem[] })`. Maps `item.status` directly to `StatusBadge`'s `status` prop (both use the same `available | taken | mine | given` union — no translation needed).

#### 5. Components barrel

**File**: `src/app/lists/[token]/components/index.ts`

**Intent**: Re-export both new components, per CLAUDE.md's single-barrel convention.

**Contract**: `export { VisibilityBanner } from "./visibility-banner/visibility-banner"; export { SharedItemList } from "./shared-item-list/shared-item-list";`

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- None for this phase — components aren't wired to a route yet; verified end-to-end in Phase 2.

---

## Phase 2: Route wiring and manual verification

### Overview

Add the page itself, assembling Phase 1's pieces against `getSharedList`, and confirm the full set of viewer states against a running local stack.

### Changes Required:

#### 1. Shared-list page

**File**: `src/app/lists/[token]/page.tsx`

**Intent**: Server Component mirroring `events/[id]/page.tsx`'s structure: call `getSharedList(token)`, `notFound()` on `not_found`, an `Alert` on `error`, and on `ok` render the event name/date/timezone header, `VisibilityBanner`, and `SharedItemList`.

**Contract**: `export default async function SharedListPage({ params }: { params: Promise<{ token: string }> })`. Passes `getVisibilityBanner(result.event, result.items)` into `VisibilityBanner`'s `kind` prop.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Full unit suite still green: `pnpm test`

#### Manual Verification:

- Unauthenticated visitor on a valid share link: sees event name + all items, no status badges, "sign in to see availability" banner with a working `/login?next=/lists/[token]` link that returns here after sign-in.
- Signed-in guest (not the owner) on the same link: sees real status badges (`available`/`taken`/`mine`/`given` as applicable) on every item, no banner.
- Organizer visiting their own share link before the reveal: sees all items with no status badges, Yoda-voiced banner, and the link back to `/events/[id]` works.
- Organizer visiting after unlocking the reveal (`unlock_event`) or after `event_date + 2`: sees real status badges, no banner.
- Invalid or malformed token: renders the existing global 404 page.
- Simulated RPC failure: renders the danger `Alert`, not a false "not found."
- Event with zero items, in each viewer state: shows the guest-appropriate empty-state copy, no banner.

**Implementation Note**: Pause here for manual confirmation from the human that the manual testing above passed before considering the slice done.

---

## Testing Strategy

### Unit Tests:

- `getVisibilityBanner`: all three return values, plus the organizer-post-reveal and zero-items edge cases.

### Integration Tests:

- None added — no new invariant is being enforced at the data layer (F-02 already owns and tests those). This slice is presentational only.

### Manual Testing Steps:

See Phase 2's Manual Verification list above — it is the complete manual test plan for this slice.

## Performance Considerations

None beyond what `getSharedList` already does (two parallel RPC calls, no caching, per CLAUDE.md's "never cached" rule for the shared-list read path).

## Migration Notes

None — no schema or data changes in this slice.

## References

- Data layer this slice wires into: `src/lib/lists/shared-list.ts`, `src/lib/lists/types.ts`
- RPC contract: `supabase/migrations/20260911221653_shared_list_rpcs.sql`
- Sibling page to mirror: `src/app/events/[id]/page.tsx`
- Prior plan for the data contract: `context/changes/surprise-rule-data-contract/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Visibility logic and presentational components

#### Automated

- [ ] 1.1 Unit tests pass: `pnpm test`
- [ ] 1.2 Type checking passes: `pnpm typecheck`
- [ ] 1.3 Linting passes: `pnpm lint`

### Phase 2: Route wiring and manual verification

#### Automated

- [ ] 2.1 Type checking passes: `pnpm typecheck`
- [ ] 2.2 Linting passes: `pnpm lint`
- [ ] 2.3 Full unit suite still green: `pnpm test`

#### Manual

- [ ] 2.4 Unauthenticated visitor: items visible, no badges, sign-in banner with working `next` round-trip
- [ ] 2.5 Signed-in non-owner guest: real status badges on every item, no banner
- [ ] 2.6 Organizer pre-reveal: no badges, Yoda banner, working link to `/events/[id]`
- [ ] 2.7 Organizer/anyone post-reveal (unlocked or past `event_date + 2`): real status badges, no banner
- [ ] 2.8 Invalid/malformed token renders the global 404
- [ ] 2.9 Simulated RPC failure renders the danger `Alert`, not "not found"
- [ ] 2.10 Zero-item event, each viewer state: guest-appropriate empty copy, no banner
