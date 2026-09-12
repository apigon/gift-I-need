# Edit List Items Implementation Plan

## Overview

Implements S-04 (`edit-list-items`, FR-005): an authenticated organizer can edit an item on their own event (title, notes, link, price range) from the `/events/[id]` manage page they already use to add items. The database write path — grants, RLS ownership scoping, and the post-reveal read-only lock — already exists from F-02 and is already pgTAP-covered for the reveal-closed case. This slice adds the DAL update function, a new `Modal` design-system primitive (none exists yet), and the edit UI itself: a per-item "Edit" button opening a modal form, closing on save with an inline list update plus a supplementing toast.

## Current State Analysis

- `src/lib/lists/owned-events.ts` has `createEvent`, `addItem`, `getOwnedEvent` — all straight RLS-scoped reads/writes against `public.events`/`public.items`, no RPC layer (that pattern is reserved for the claims/reveal side). There is no `updateItem`.
- `supabase/migrations/20260911211956_surprise_rule_schema.sql` already grants `update (title, notes, link, price_range)` on `items` to `authenticated`, and `items_update_owner`'s `USING`/`WITH CHECK` already scope to `private.is_event_owner(event_id)` and block the write once `private.reveal_open(event_id)` is true. `02_events_items.test.sql:135-157` already proves post-reveal item writes return `42501`. **No new migration is needed for this slice.**
- `getOwnedEvent` currently selects `id, name, event_date, timezone, share_token` from `events` — it does not select `revealed_at`/`auto_reveal_at`, so `OwnedEvent` (types.ts) has no notion of reveal state. The table-wide `grant select on public.events to authenticated` (not column-scoped — see the lessons-file entry on this) already lets the owner read those two columns; nothing needs to change at the DB layer to expose them.
- `ItemList` (`src/app/events/[id]/components/item-list/item-list.tsx`) is currently a plain (non-`"use client"`) function component rendering static `<Text>` per item — no interactivity, no client boundary.
- The design system (`src/components/`) has `Input`, `Button`, `Alert`, `StatusBadge`, `Combobox`, `Toaster`/`notify` — no `Modal`/`Dialog` primitive. `globals.css` has no overlay/scrim token.
- `AddItemForm` + `addItem` (Server Action, `src/app/actions/events.ts`) establish the pattern this slice mirrors: zod-parse `FormData` → call the DAL → on success, `refresh()` (next/cache) + return `{ status: "idle" }`; on failure, a single generic error message (`GENERIC_ERROR`) regardless of the specific `ListErrorCode` — this codebase does not give every code its own copy.
- `AddItemSchema` (`src/lib/lists/schemas.ts`) already validates exactly the four fields an edit needs (title/notes/link/priceRange), mirroring the same DB CHECK constraints an update is still subject to.

## Desired End State

An organizer viewing `/events/[id]` sees an "Edit" button on each item. Clicking it opens a modal pre-filled with that item's current values. Saving validates client-side (same rules as add), calls a new `updateItem` Server Action, and on success closes the modal, shows the item's new values in the list (via `refresh()`), and shows a supplementing "Item updated" toast. Cancelling (button, Escape, or backdrop click) discards any edits with no prompt. Once the event's reveal has opened (`revealed_at` set or `now() >= auto_reveal_at`), the Edit button no longer appears on any item in that event.

### Key Discoveries:

- `items_update_owner`'s `WITH CHECK (private.is_event_owner(event_id) and not private.reveal_open(event_id))` (`20260911211956_surprise_rule_schema.sql`) means the DB already refuses a post-reveal edit — this slice's "hide the Edit button after reveal" is a UX improvement over a bare error, not a new invariant to enforce.
- A post-reveal update and a missing-column-grant update both raise SQLSTATE `42501`, and `mapRpcError` collapses both to `not_authenticated` — but `updateItem`'s Server Action follows `addItem`'s existing "one generic message for every failure code" policy, so this ambiguity never reaches a user-visible string. No change to `mapRpcError` is needed.
- `public.events` SELECT is table-wide (not column-scoped) to `authenticated`, so `getOwnedEvent` can read `revealed_at`/`auto_reveal_at` today with no grant change — only a query and a computed field.

## What We're NOT Doing

- Item deletion (PRD Non-Goal; out of scope for all of v1).
- Any new migration, RLS policy, or RPC — the write path is already shipped and tested.
- Optimistic-concurrency / edit-conflict detection — last write wins, matching the precedent set by `events.name` editing (no `updated_at`-based check exists anywhere in this schema).
- A "discard changes?" confirmation on cancel — cancel always discards silently.
- Dirty-state tracking / disabling Save until a field changes — Save is always enabled, matching `AddItemForm`/`CreateEventForm`.
- Un-hiding editing manually before the DB-level unlock (`unlock_event`) — that RPC is S-05's concern; this slice only reads `revealed_at`/`auto_reveal_at`, it never calls `unlock_event`.
- Component-testing infrastructure for `Modal` — verified manually, same as `Combobox`.

## Implementation Approach

Mirror the `create-and-share-event-list` slice's shape end to end: a DAL function in `owned-events.ts`, a Server Action in `events.ts` following the exact `addItem` contract, and client components built from existing (plus one new) design-system primitives with `useActionState`. The one new piece of infrastructure is `Modal`, built on the native `<dialog>` element — `showModal()` gives top-layer rendering, a built-in focus trap, and native `Escape`-to-close for free, which is why it's the natural choice here (versus hand-rolling `aria-modal` machinery the way `Combobox` had to hand-roll the listbox pattern, for which no native element exists).

## Critical Implementation Details

### State sequencing — native `<dialog>` synchronization

`<dialog>`'s modal state is imperative (`showModal()` / `close()`), not a reactive attribute — passing a React `open` boolean to `<dialog open>` only gives the non-modal mode (no top layer, no focus trap, no `::backdrop`). `Modal` must reconcile this itself: an effect on the `open` prop calls `showModal()` when it flips true and `close()` when it flips false, AND the dialog's native `close` event (fired by `Escape` or by a `dialogRef.current.close()` call from a backdrop click) must call the passed `onClose` so the parent's state — which is the source of truth for whether the modal is mounted/open — stays in sync. Route every close path (Cancel button, backdrop click, Escape) through `dialogRef.current.close()` so there is exactly one place (the `close` event listener) that calls `onClose`, rather than three call sites needing to agree.

`EditItemModal` should key itself off the editing item's id (render only when an item is being edited; key by `item.id`) so its field `useState`s re-seed correctly from props when the organizer moves from editing one item to another, without needing a manual reseed effect.

## Phase 1: Data layer — `updateItem` and reveal-state

### Overview

Adds the DAL write path and the reveal-state read the UI needs to hide the Edit affordance after the reveal. No schema change.

### Changes Required:

#### 1. `src/lib/lists/owned-events.ts`

**Intent**: Add `updateItem`, mirroring `addItem`'s shape exactly (same input validation boundary, same `ListResult` return, same `mapRpcError` mapping). Extend `getOwnedEvent`'s `events` select to include `revealed_at, auto_reveal_at` and compute a `revealOpen` boolean the same way `private.reveal_open` does (`revealed_at is not null or now() >= auto_reveal_at`), evaluated in JS against the fetched row rather than a new RPC call.

**Contract**:
```
updateItem(itemId: string, input: { title: string; notes?: string; link?: string; priceRange?: string }): Promise<ListResult>
```
Calls `.from("items").update({ title, notes: input.notes ?? null, link: input.link ?? null, price_range: input.priceRange ?? null }).eq("id", itemId).select("id").single()`, mirroring `createEvent`'s existing `.select("id").single()` pattern. This is required, not optional: `items_update_owner`'s `USING` clause scopes the match to `private.is_event_owner(event_id)` with no error on a non-match — a non-owned or stale `itemId` just matches 0 rows and Postgres reports success. Without `.select().single()`, `updateItem` couldn't tell "1 row updated" from "0 rows matched," so it would report `{ ok: true }` even when nothing changed. With `.single()`, a 0-row match raises a Postgrest error (`PGRST116`), which flows through the existing `mapRpcError` → `"unknown"` → generic-message path with no new UI branch needed. The returned row itself is still discarded — `refresh()` re-fetches via `getOwnedEvent`.

`getOwnedEvent`'s `events` select becomes `"id, name, event_date, timezone, share_token, revealed_at, auto_reveal_at"`; `OwnedEvent` (types.ts) gains `revealOpen: boolean`, computed as `eventRow.revealed_at !== null || Date.now() >= new Date(eventRow.auto_reveal_at).getTime()` and NOT as a raw passthrough of the two timestamp columns — the type should expose only the boolean the UI needs, consistent with `SharedEvent.revealOpen`'s shape.

#### 2. `src/lib/lists/types.ts`

**Intent**: Add `revealOpen: boolean` to `OwnedEvent`.

**Contract**: One field addition to the existing `OwnedEvent` type.

#### 3. `src/lib/lists/schemas.ts`

**Intent**: Reuse the existing field-validation rules for edit submissions without duplicating them — an edit submits the same four fields under the same DB CHECK constraints as add.

**Contract**: Export `EditItemSchema` and `EditItemFieldErrors` as aliases of `AddItemSchema`/`AddItemFieldErrors` (`export const EditItemSchema = AddItemSchema; export type EditItemFieldErrors = AddItemFieldErrors;`) so the Server Action and form component read as edit-specific without a second copy of the validation rules to drift from the add path.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test` — new `updateItem` cases (success; DAL-error mapping) and `getOwnedEvent` `revealOpen` cases (false when neither `revealed_at` nor `auto_reveal_at` has passed; true when `revealed_at` is set; true when `auto_reveal_at` has passed) added to `owned-events.test.ts`, following the existing `makeBuilder` mock pattern — `makeBuilder` currently stubs `insert`/`select`/`eq`/`order`/`single`/`then` but no `update`; add `builder.update = vi.fn(returnsBuilder);` alongside these tests

#### Manual Verification:

- None for this phase — no UI changes yet

---

## Phase 2: `Modal` design-system primitive

### Overview

A new reusable modal dialog primitive, since none exists. Built on native `<dialog>` per the Critical Implementation Details note above.

### Changes Required:

#### 1. `src/components/modal/modal.tsx`

**Intent**: A controlled modal dialog — `open` boolean + `onClose` callback, matching every other primitive's controlled-component shape (e.g. `Combobox`'s `value`/`onChange`). Renders its `children` inside the native `<dialog>`'s content box, with a heading built from a `title` prop for `aria-labelledby`.

**Contract**: `Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode })`. Internals per the Critical Implementation Details note: an effect syncing `open` to `showModal()`/`close()`, a `close` event listener calling `onClose`, and a backdrop click handler (`if (event.target === dialogRef.current) dialogRef.current?.close()`) that routes through the same native `close()` call rather than calling `onClose` directly.

#### 2. `src/app/globals.css`

**Intent**: Add the one new token `Modal`'s backdrop needs — this design system has no existing scrim/overlay color, and raw Tailwind palette classes or arbitrary hex are lint-forbidden.

**Contract**: A new `--color-overlay` token in the existing `@theme` block, applied to the dialog's `::backdrop`. Value should read as a translucent dark scrim consistent with the existing palette (e.g. derived from `--color-fg` at reduced opacity via `color-mix`), not an arbitrary new hue.

#### 3. `src/app/design-system/components/modal-demo/modal-demo.tsx` + barrel + `src/app/design-system/page.tsx`

**Intent**: Per the design-system rule that a new token/primitive ships with a showcase entry (the same rule `Combobox` followed in S-01) — a small interactive demo (a button that opens a `Modal` with sample content) plus the new `overlay` swatch added to the existing `SWATCHES` array.

**Contract**: Follows the exact structure of `combobox-demo/combobox-demo.tsx` and its `## Combobox` section in `page.tsx` — a new `## Modal` section, `ModalDemo` added to the `components/index.ts` barrel and imported into `page.tsx`.

`SWATCHES` entries are `{ name, hex: string, role, className }`, rendered as a flat `h-12` box with the literal `hex` printed as text — neither fits a `color-mix()`-derived translucent token as-is. For the new `overlay` entry: put the token's CSS expression (e.g. `color-mix(in srgb, var(--color-fg) 45%, transparent)`) in the `hex` field instead of a literal hex string, and render that swatch's box over a contrasting inner backdrop (e.g. a small `bg-fg` tile nested inside it) rather than the bare `surface`/`canvas` page background, so the translucency is actually visible per this phase's own manual-verification check.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- `/design-system` (dev only) shows the Modal demo: opens on click, traps focus (Tab cycles only within the dialog), closes on Escape, closes on backdrop click, closes on an in-dialog close button
- The new `overlay` swatch renders in the Colour tokens section and looks like a translucent scrim, not a solid new color
- Visual check against `context/changes/design-system-baseline/palette-proof.html` conventions (same check S-01 ran for `Combobox`)

---

## Phase 3: Edit item flow

### Overview

Wires the Edit button, the modal form, and the Server Action together. `ItemList` becomes a client component.

### Changes Required:

#### 1. `src/app/actions/events.ts`

**Intent**: `updateItem` Server Action, matching `addItem`'s contract exactly (parse → call DAL → `refresh()` + idle on success, generic message on any failure).

**Contract**: `updateItem(itemId: string, _prevState: FormState<EditItemFieldErrors>, formData: FormData): Promise<FormState<EditItemFieldErrors>>`, bound via `.bind(null, item.id)` the same way `addItem` is bound to `eventId`. No redirect — same as `addItem`.

#### 2. `src/app/events/[id]/components/edit-item-modal/edit-item-modal.tsx`

**Intent**: The edit form, rendered inside `Modal`. Pre-fills its fields from the `item` prop (title/notes/link/priceRange), submits through `updateItem`, and — unlike `AddItemForm`, which resets to blank on success — closes the modal on success (calls `onClose`) rather than resetting fields, since there's no "add another" continuation here.

**Contract**: `EditItemModal({ item, open, onClose }: { item: OwnedItem; open: boolean; onClose: () => void })`. On a successful save (the `useActionState` result leaves `status !== "error"`, i.e. `"idle"` — the same signal `AddItemForm` treats as "just succeeded"), call `notify.success("Item updated")` then `onClose()` — mirroring `AddItemForm`'s existing `useEffect`-on-`state` pattern, but closing instead of resetting. Same field set and same `error`/`hint` wiring as `AddItemForm`'s `Input`s.

#### 3. `src/app/events/[id]/components/item-list/item-list.tsx`

**Intent**: Add an "Edit" button per item (opens that item's modal) and host the single `EditItemModal` instance for whichever item is currently being edited. Becomes a client component (`"use client"`) since it now owns interaction state.

**Contract**: `ItemList({ items }: { items: OwnedItem[] })` gains internal `editingItemId: string | null` state (via `useState`). Each `<li>` gets a `Button variant="secondary"` "Edit" click handler setting `editingItemId`. `EditItemModal` is rendered once, conditionally, keyed by the editing item's id per the Critical Implementation Details note, with `item={items.find((i) => i.id === editingItemId)!}`, `open={editingItemId !== null}`, `onClose={() => setEditingItemId(null)}`.

#### 4. `src/app/events/[id]/components/index.ts`

**Intent**: Barrel export for `EditItemModal`.

**Contract**: One new `export { EditItemModal } from "./edit-item-modal/edit-item-modal";` line.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test` — `updateItem` DAL already covered in Phase 1; no new unit-testable logic here beyond what Phase 1 covers (Server Actions and client components are the manually-verified layer in this codebase, matching `addItem`'s own lack of a dedicated action test)

#### Manual Verification:

- Clicking Edit on an item opens the modal pre-filled with that item's current title/notes/link/price range
- Editing a field and saving updates the item in the list immediately (no page reload) and shows the "Item updated" toast
- Cancel (button, Escape, backdrop click) closes the modal with no change to the item, even after editing fields
- A validation error (e.g. clearing the required title) shows inline under the field, same as `AddItemForm`, and keeps the modal open with the user's edits intact
- Editing two different items in sequence shows the correct item's values each time (no stale field carry-over)
- Clearing an optional field (e.g. deleting existing notes text) and saving actually clears it in the list, not leaves the old value

**Implementation Note**: Pause here for manual confirmation before Phase 4.

---

## Phase 4: Hide editing after the reveal

### Overview

Threads `revealOpen` (Phase 1) through to `ItemList` so the Edit button disappears once the reveal has opened, replacing what would otherwise be a bare DB-error UX for a rare but real case (an organizer editing when their event's reveal instant has just passed).

### Changes Required:

#### 1. `src/app/events/[id]/page.tsx`

**Intent**: Pass the already-fetched `event.revealOpen` down to `ItemList`.

**Contract**: `<ItemList items={items} revealOpen={event.revealOpen} />`.

#### 2. `src/app/events/[id]/components/item-list/item-list.tsx`

**Intent**: Hide the Edit button (and don't open the modal) once `revealOpen` is true.

**Contract**: `ItemList` gains a `revealOpen: boolean` prop; the per-item Edit button renders only when `!revealOpen`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:

- With a real event whose `revealed_at` has been set directly in the local DB (or `auto_reveal_at` backdated), reloading `/events/[id]` shows no Edit buttons on that event's items
- An event whose reveal hasn't opened still shows Edit buttons as in Phase 3

---

## Phase 5: DB test coverage

### Overview

Closes a real gap: `items_update_owner`'s owner-isolation branch (as opposed to its reveal-closed branch, already covered) has no pgTAP case proving a stranger's update is denied.

### Changes Required:

#### 1. `supabase/tests/02_events_items.test.sql`

**Intent**: Add a stranger-cannot-update-another-owner's-item case, mirroring the existing events-table stranger pattern already in this file (lines 39–51: switch role, attempt the write, switch back, assert no change) but for `items` instead of `events`.

**Contract**: Bump `select plan(19)` to the new total. New assertions: as the stranger (`00000000-0000-0000-0000-0000000000a2`), `update public.items set title = 'Hijacked' where id = :'fx_item_id'` is attempted (capture the item id from the existing `Item One Renamed` fixture via `\gset`); switching back to the owner, `isnt_empty`/`results_eq` confirms the title is unchanged.

### Success Criteria:

#### Automated Verification:

- DB tests pass: `pnpm test:db` (needs `colima start`, `supabase start`)
- Full suite green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`

#### Manual Verification:

- None — this phase is test-only

---

## Testing Strategy

### Unit Tests:

- `updateItem`: success path, DAL-error mapping (mirrors `addItem`'s two existing cases)
- `getOwnedEvent`'s `revealOpen` computation: false (neither trigger fired), true via `revealed_at` set, true via `auto_reveal_at` passed

### Integration Tests:

- None new — the existing race/integration suite (`claim-race.integration.test.ts`) covers the claim path, which this slice doesn't touch

### Manual Testing Steps:

1. Sign in as an organizer with an existing event and at least one item; open `/events/[id]`
2. Click Edit, change every field, save — confirm inline update + toast
3. Click Edit, change nothing, cancel via each of the three paths (button, Escape, backdrop click) — confirm no change
4. Click Edit, clear an optional field, save — confirm it's actually cleared (not left stale)
5. Trigger a validation error (empty title) — confirm inline field error, modal stays open, edits preserved
6. With the reveal opened (`revealed_at` set locally), reload and confirm no Edit buttons appear

## Performance Considerations

None beyond what `addItem` already establishes — a single-row update, no new query patterns, no caching involved (this DAL module is explicitly never cached, per CLAUDE.md).

## Migration Notes

None — no schema change in this slice.

## References

- Prior slice this mirrors: `context/archive/2026-09-12-create-and-share-event-list/plan.md`
- Data contract this depends on: `context/changes/surprise-rule-data-contract/plan.md`, `supabase/migrations/20260911211956_surprise_rule_schema.sql`
- `src/app/actions/events.ts:61-95` (`addItem` — the Server Action contract this mirrors)
- `src/app/events/[id]/components/add-item-form/add-item-form.tsx` (the `useActionState` + field pattern this mirrors)
- `src/components/combobox/combobox.tsx` (prior art for a hand-rolled, fully-accessible primitive with no UI-library dependency)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer — `updateItem` and reveal-state

#### Automated

- [x] 1.1 Type checking passes: `pnpm typecheck`
- [x] 1.2 Linting passes: `pnpm lint`
- [x] 1.3 Unit tests pass: `pnpm test`

### Phase 2: `Modal` design-system primitive

#### Automated

- [ ] 2.1 Type checking passes: `pnpm typecheck`
- [ ] 2.2 Linting passes: `pnpm lint`

#### Manual

- [ ] 2.3 `/design-system` Modal demo opens, traps focus, closes on Escape/backdrop/close button
- [ ] 2.4 New `overlay` swatch renders correctly in the Colour tokens section
- [ ] 2.5 Visual check against `palette-proof.html` conventions

### Phase 3: Edit item flow

#### Automated

- [ ] 3.1 Type checking passes: `pnpm typecheck`
- [ ] 3.2 Linting passes: `pnpm lint`
- [ ] 3.3 Unit tests pass: `pnpm test`

#### Manual

- [ ] 3.4 Edit opens the modal pre-filled with the item's current values
- [ ] 3.5 Saving updates the item in the list immediately and shows the toast
- [ ] 3.6 Cancel (button, Escape, backdrop click) discards edits with no change
- [ ] 3.7 A validation error shows inline, modal stays open, edits preserved
- [ ] 3.8 Editing two different items in sequence shows correct values each time
- [ ] 3.9 Clearing an optional field and saving actually clears it

### Phase 4: Hide editing after the reveal

#### Automated

- [ ] 4.1 Type checking passes: `pnpm typecheck`
- [ ] 4.2 Linting passes: `pnpm lint`

#### Manual

- [ ] 4.3 No Edit buttons appear once the reveal has opened
- [ ] 4.4 Edit buttons still appear before the reveal opens

### Phase 5: DB test coverage

#### Automated

- [ ] 5.1 DB tests pass: `pnpm test:db`
- [ ] 5.2 Full suite green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`
