# Edit List Items — Plan Brief

> Full plan: `context/changes/edit-list-items/plan.md`

## What & Why

Implements S-04 (FR-005): an organizer can edit an item's title, notes, link, and price range on an event they created. It's the strongest parallel-with candidate on the roadmap — independent of the core claim loop (S-02/S-03) — and the natural slice to fan out to a separate agent run when capacity is the blocker.

## Starting Point

F-02 already shipped the full write path for item edits: `items` has an `update (title, notes, link, price_range)` grant to `authenticated`, and the `items_update_owner` RLS policy already scopes updates to the owning organizer and blocks them once the reveal has opened — both already pgTAP-covered. S-01 shipped `addItem`/`AddItemForm` as the pattern to mirror, and the design system has no `Modal`/`Dialog` primitive yet.

## Desired End State

On `/events/[id]`, every item has an "Edit" button that opens a modal pre-filled with its current values. Saving updates the item in place (list refresh + a supplementing toast); cancelling (button, Escape, or backdrop click) always discards silently. Once an event's reveal has opened, the Edit button no longer appears on that event's items.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Edit UX pattern | Modal dialog | Keeps the list clean; accepted the added scope of building a new `Modal` primitive |
| New primitive built on | Native `<dialog>` + `showModal()` | Gets a focus trap, top-layer rendering, and native Escape-to-close for free, unlike hand-rolling `aria-modal` the way `Combobox` had to hand-roll its listbox pattern |
| Reveal-closed editing | Hide the Edit button proactively once `revealOpen` | The DB already blocks the write (42501); showing a confusing generic error at the exact moment an event reveals is a bad first impression, and computing `revealOpen` costs only a query change, not a new grant |
| Edit vs. add-conflict handling | Last write wins, no concurrency check | Matches the existing precedent (`events.name` editing has no `updated_at` check either); a single-organizer-per-event product makes a true double-edit rare |
| Save feedback | Inline list update + a supplementing toast | Matches the design system's toast rule (never the *only* confirmation) while still giving an explicit success signal |
| Cancel/dismiss | Discard silently, no confirmation prompt | Matches the low-stakes, easy-to-redo nature of editing an item; avoids a second confirmation UI this slice would also have to build |
| Save button gating | Always enabled, no dirty-tracking | Matches `AddItemForm`/`CreateEventForm`, neither of which tracks a dirty flag |
| DB test scope | Add a stranger-cannot-update-item pgTAP case | Closes a real, previously-untested gap in `items_update_owner`'s owner-isolation branch (only its reveal-closed branch was covered) |
| First thing to cut if time is tight | The proactive reveal-closed hiding (Phase 4) | The core edit flow (FR-005) ships either way; this is a rare edge case for a slice landing before S-05 (reveal) exists on the roadmap |

## Scope

**In scope:**
- `updateItem` in `owned-events.ts`, `revealOpen` added to `getOwnedEvent`/`OwnedEvent`
- A new `Modal` design-system primitive + `overlay` token + `/design-system` showcase demo
- `updateItem` Server Action, `EditItemModal`, `ItemList` promoted to a client component with per-item Edit buttons
- Hiding the Edit affordance once the reveal has opened
- pgTAP coverage for the items-table owner-isolation branch on UPDATE

**Out of scope:**
- Item deletion (PRD Non-Goal for all of v1)
- Any new migration, RLS policy, or RPC — the write path already exists
- Optimistic-concurrency/edit-conflict detection, a "discard changes?" prompt, dirty-state Save gating
- Component-testing infrastructure for `Modal` (verified manually, like `Combobox`)

## Architecture / Approach

Same shape as `create-and-share-event-list`: a DAL function in `owned-events.ts`, a Server Action in `events.ts` matching `addItem`'s exact contract (parse → call DAL → `refresh()` + idle, or one generic error message), and client components built from existing primitives plus the new `Modal`. `Modal` is a controlled component (`open`/`onClose`) wrapping native `<dialog>`, reconciling React's declarative `open` prop against the element's imperative `showModal()`/`close()` API.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data layer | `updateItem` DAL function, `revealOpen` on `OwnedEvent`, unit tests | None significant — a straight mirror of `addItem`/`getOwnedEvent` |
| 2. Modal primitive | New `Modal` component, `overlay` token, showcase demo | Reconciling native `<dialog>` imperative state with React's declarative `open` prop |
| 3. Edit item flow | `updateItem` action, `EditItemModal`, `ItemList` → client component | `ItemList`'s Server-to-Client promotion; correct field re-seeding across items |
| 4. Reveal-closed UX | Thread `revealOpen` to hide the Edit button post-reveal | None significant — first phase to defer if time is tight |
| 5. DB coverage | pgTAP case for items-table owner isolation on UPDATE | None significant |

**Prerequisites:** S-01 (`create-and-share-event-list`) and F-02 (`surprise-rule-data-contract`), both already shipped; local Supabase stack running for `pnpm test:db` (`colima start`, `supabase start`).
**Estimated effort:** ~1-2 sessions across 5 phases; Phase 3 (the Server-to-Client `ItemList` promotion plus modal wiring) is the largest.

## Open Risks & Assumptions

- Testing Phase 4 locally requires manually setting `revealed_at` (or backdating `auto_reveal_at`) on a real event row — there's no UI trigger for it yet since S-05 (the reveal itself) hasn't shipped.
- `Modal`'s native-`<dialog>` approach assumes current-generation browser support (`showModal()`, `::backdrop`) — acceptable given the rest of this codebase's baseline (no polyfills used anywhere else).
- The `overlay` token's exact value (a `color-mix`-derived scrim vs. a flat translucent color) is left to implementation-time judgment within the "no raw Tailwind palette / arbitrary hex" constraint.

## Success Criteria (Summary)

- An organizer can edit any item on their own event and see the change reflected immediately, with no raw Postgres error ever reaching the UI.
- Nobody but the owning organizer can edit an item (pgTAP-proven both for the reveal-closed case, already covered, and the owner-isolation case, added in Phase 5).
- Once an event's reveal has opened, no Edit affordance is shown for its items.
- The new `Modal` is fully keyboard-operable (focus trap, Escape) and visually consistent with the rest of the design system.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:db` all pass.
