# Post-Event Reveal — Plan Brief

> Full plan: `context/changes/post-event-reveal/plan.md`

## What & Why

After an event's reveal opens — automatically at `event_date + 2`, or manually from `event_date + 1` — the organizer should see full claim status for every item (never claimer identity), and either the claiming guest or the organizer should be able to mark an item "given." This is the S-05 roadmap slice, the second half of GIN's "surprise rule" made user-visible.

## Starting Point

The backend is already done: `claim_item`, `mark_given`, `unlock_event`, `reveal_open`, `get_shared_event`, `get_shared_items` all exist as tested RPCs, and `shared-list.ts` already exports `markGiven`/`unlockEvent` — nothing calls them yet. The organizer's own page (`/events/[id]`) currently reads items via a direct table query that structurally cannot see claim status (`public.claims` has zero API grants); the guest page (`/lists/[token]`) reads status correctly already but has no interactive controls.

## Desired End State

Post-reveal, the organizer's event page shows each item's real status (`available`/`taken`/`given`) via the existing `StatusBadge`. From `event_date + 1`, the organizer sees a plain "Unlock now" button. Once revealed, the claiming guest (on their own `'mine'` item) and the organizer (on any `'taken'` item) both get a "Mark as given" button — first click wins, the other's click is a harmless no-op.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Manual test strategy | Seed claims via direct RPC call, not a UI flow | claim-gift-item (S-03), this change's prerequisite, is unplanned — no claim button exists yet, and the RPC layer is already pgTAP-proven |
| Organizer's status read | Reuse `getSharedList` via the event's own `share_token`, merged with `getOwnedEvent` | Zero new backend code; reuses the exact RPC path already tested for organizer-blindness |
| Mark-given placement | Both parties, contextually — guest on `/lists/[token]`, organizer on `/events/[id]` | Matches FR-010 exactly (either party, first past the post) |
| Unlock control UX | Plain button, no confirmation modal | Matches the PRD's own reasoning (a determined organizer can already spoil it another way) and the existing no-confirmation pattern for mark-given |
| Unclaimed items post-reveal | Show as "Available," no button | Exactly what `get_shared_items` already returns — no special-casing |
| Status-overlay RPC failure | Degrade gracefully — item list stays usable, only the status column is missing | One failed read-only overlay shouldn't take down the organizer's ability to view/manage their list |
| New pgTAP coverage | None — the owner-reads-own-token-after-reveal path is already covered by `04_shared_list.test.sql:77-83` | Discovered during research; the "yes, add a test" intent is honored at the application layer instead (Phase 1's merge helper) |
| Unlock eligibility notice | Button alone, no separate banner | Keeps `VisibilityBanner`'s job scoped to announcing hidden states, not available actions |

## Scope

**In scope:**
- Organizer sees real claim status post-reveal (`/events/[id]`)
- Manual early-unlock control for the organizer
- "Mark as given" for both claimer and organizer
- Graceful degradation if the status-overlay read fails

**Out of scope:**
- Claim-button UI (S-03, separate unplanned change)
- New migrations, tables, RLS, or RPCs (none needed)
- Confirmation modal or banner for the unlock control
- New pgTAP tests
- Event archive/delete lifecycle after reveal (open roadmap question)
- Realtime/websocket status updates

## Architecture / Approach

Every claim-status read goes through the existing `get_shared_*` RPCs — never `public.claims` directly. The organizer's page composes two independent reads (`getOwnedEvent` for owner-only chrome, `getSharedList` for status) via a new pure merge function, rather than introducing a new RPC — keeping the one place that enforces organizer-blindness exactly where it already lives and is already tested.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data & Server Action foundation | `unlockable` field, status-merge helper, `markGiven`/`unlockEvent` Server Actions — no UI | Low; pure logic, fully unit-testable |
| 2. Guest-side mark-given UI | "Mark as given" button on `/lists/[token]` for the claimer, gated correctly by reveal state | Gating bug could let a pre-reveal guest attempt (and fail) a mark-given call |
| 3. Organizer-side overlay, mark-given & unlock | Status display, mark-given, and manual unlock on `/events/[id]` | Composing two reads correctly, and degrading gracefully if one fails |

**Prerequisites:** Local Supabase stack running (`colima start && supabase start`) for manual verification; no claim UI exists yet, so claims must be seeded via direct RPC call during manual testing.
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Manual end-to-end testing depends on seeding claims outside the UI (via direct `claim_item` RPC calls) until `claim-gift-item` ships — this is a deliberate, confirmed tradeoff, not an oversight.
- The merge-by-`id` approach between `getOwnedEvent` and `getSharedList` assumes the item set is frozen once revealed (true, per RLS), so a mismatch should never occur in practice — the merge helper handles it defensively anyway.

## Success Criteria (Summary)

- Organizer never sees claim status before the reveal opens, and always sees it (minus claimer identity) after.
- Either the claimer or the organizer can mark an item given exactly once, from whichever side they're on.
- The organizer can pull the reveal forward from `event_date + 1` with one click, and never earlier.
