# Browse Shared List — Plan Brief

> Full plan: `context/changes/browse-shared-list/plan.md`

## What & Why

Build the guest-facing route at `/lists/[token]` so an organizer's shared link actually resolves to something. Guests need to browse an event's gift ideas and see availability without signing in to view (only to see status), per PRD FR-007/FR-009 — the load-bearing "surprise rule" that makes GIN more than a shared spreadsheet.

## Starting Point

F-02 (`surprise-rule-data-contract`) already shipped the entire data layer: `getSharedList(token)` and the `get_shared_event`/`get_shared_items` RPCs already compute a correct per-viewer status (`null` for an unauthenticated visitor or the organizer pre-reveal; real status otherwise) and are fully unit-tested. The share URL (`/lists/[token]`) is already generated and shown on the organizer's page (`events/[id]/page.tsx`), but the route itself doesn't exist yet — that's the entire gap this plan closes.

## Desired End State

Anyone opening a valid share link sees the event and every item, with a status badge wherever the RPC actually returns one, and exactly one explanatory banner when it doesn't (organizer pre-reveal, or signed-out guest) — never a mix of both, never per-item explanations.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Null-status messaging | Two distinct banners (organizer vs. guest) | Both get `status: null` from the RPC but need opposite calls to action — wait vs. sign in — and the data to tell them apart (`event.isOwner`) already exists. |
| Organizer's own visit | Same route, no redirect, with a Yoda-voiced banner + link to `/events/[id]` | Matches the existing `not-found.tsx` tone; a redirect would break the legitimate case of an organizer previewing their own guest-facing page. |
| Claim affordance | None — purely read-only | Claiming is S-03's explicit scope on the roadmap; building it here risks throwaway UI once S-03 lands. |
| Empty-list copy | Guest-specific ("No gift ideas here yet.") | The organizer's existing empty-state text ("...add the first one below") is wrong here — guests can't add items. |
| Page title | Skip `generateMetadata`, keep app default | Avoids a second data fetch for marginal polish; can be revisited later. |
| Banner gating logic | Gate on "does any item actually have `status === null`," not just `isOwner` | An organizer viewing post-reveal gets real statuses and needs no banner; gating on `isOwner` alone would show a stale notice. |

## Scope

**In scope:**
- New route `src/app/lists/[token]/page.tsx`
- `VisibilityBanner` and `SharedItemList` components
- A pure, unit-tested `getVisibilityBanner` helper

**Out of scope:**
- Claiming (S-03), unlock/reveal UI changes (S-05), any RPC/schema change (F-02 already correct), page metadata

## Architecture / Approach

Server Component reads `getSharedList(token)`, branches on `not_found` (→ global 404) / `error` (→ danger `Alert`) / `ok`. On success, a pure helper derives which banner (if any) applies from `event.isOwner` + whether any item has `status === null`; the page renders that banner plus the item list, where each item's `StatusBadge` is shown only when its status is non-null.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Visibility logic and components | Pure banner-derivation helper (unit-tested) + `VisibilityBanner`/`SharedItemList` components | Getting the organizer-vs-guest null-status derivation wrong would either leak that someone is the organizer or show a stale banner post-reveal |
| 2. Route wiring and manual verification | The actual `/lists/[token]` page, plus a full manual pass across all viewer states | No component-test convention exists in this repo, so the four viewer states + edge cases are verified manually, not automatically |

**Prerequisites:** A local Supabase stack (`colima start && supabase start`) with a seeded event to exercise organizer pre/post-reveal states manually.
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes no future slice needs a different null-status UX per item (e.g. some items hidden, others not) — today's derivation is page-level, matching the RPC's own all-or-nothing behavior per viewer.

## Success Criteria (Summary)

- A guest can open a share link, see all items, and see real availability once signed in — never before.
- An organizer opening their own share link before the reveal sees no status information at all, with a clear explanation of why.
- Invalid tokens and RPC failures degrade correctly (404 vs. a visible error), never as a false "empty list."
