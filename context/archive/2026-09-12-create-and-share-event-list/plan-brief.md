# Organizer Creates and Shares an Event List — Plan Brief

> Full plan: `context/changes/create-and-share-event-list/plan.md`

## What & Why

Implements S-01: an authenticated organizer creates an event (name, date, timezone), adds gift ideas to it, and gets a shareable link — the first user-facing slice of GIN's core loop, and the entry point every downstream slice (browse, claim, edit, reveal) depends on. It exercises the F-02 data contract's schema and RLS end-to-end for the first time from real UI. Since no dashboard exists yet, this revision also adds a private "organizer link" back to the manage page, and moves the create-event entry point onto the home page rather than a route nothing links to.

## Starting Point

F-02 (`surprise-rule-data-contract`) already shipped the full schema, RLS, grants, and immutability trigger for `events`/`items` — the organizer inserts/updates their own rows directly under RLS, no RPC involved. `src/app/page.tsx` is currently a static marketing placeholder; the design system has no dropdown/select primitive; nothing in the UI or TypeScript layer for events/items exists yet.

## Desired End State

A signed-in visitor to `/` sees a create-event form (signed-out visitors still see the marketing copy). Creating an event lands them on a durable `/events/<id>` page where they add items one at a time and copy two links: one to share with guests (`/lists/<share_token>`), and a private one back to this same page (`/events/<id>`) — their only way back, since there's no dashboard.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Create-event entry point | The home page (`/`), branching on session — no dedicated `/events/new` route | Nothing else would link to a standalone route without a dashboard; `/` is the only place a signed-in user reliably lands |
| Home-page auth check | `getClaims()`, not `getUser()` | Avoids doubling the per-request Supabase auth round trip the layout's `AuthStatus` already pays for a check that only needs a boolean |
| Timezone picker | A new hand-rolled `Combobox` design-system primitive (searchable, ARIA combobox pattern), revealed by a "Change timezone" button over the auto-detected value | User asked for a searchable picker given ~400 IANA zones; hand-rolled to match every existing primitive (no UI-library dependency in this codebase) |
| Organizer's return path | A second copyable link (`/events/<id>` itself) shown next to the guest share link | With no dashboard, this is the only way for the organizer to get back to add more items later |
| Share-link availability | No minimum item count — link available immediately at creation | Matches FR-006; organizer can share early and curate over time |
| Adding items | One at a time via a Server Action, appended to a live list | Mirrors the existing `useActionState`/`FormState` pattern exactly |
| Item-add loading feedback | `Button`'s existing `pending`/`pendingLabel` state only | No PRD timing requirement on item-adding; avoids optimistic-state complexity |
| Invalid/foreign `/events/[id]` | `notFound()` | RLS returns zero rows either way — same response prevents enumerating other organizers' event ids |
| DB test coverage | Extend `02_events_items.test.sql` with the untested `items_title_length`/`items_notes_length`/`items_price_range_length` constraints | These constraints exist from F-02 but have zero pgTAP coverage; this slice's form is the first thing that makes them user-facing |
| Insert-type mismatch fix (plan-review, 2026-09-12) | A new migration gives `share_token`/`unlockable_at`/`auto_reveal_at` harmless `DEFAULT`s, instead of the app-layer cast originally planned | `supabase gen types` can't see trigger bodies, only column defaults; a placeholder `DEFAULT` is a zero-behavior-change root-cause fix (the trigger overwrites it unconditionally on every insert) — accepted as a scope deviation from "no new migration" |

## Scope

**In scope:**
- Create-event form on `/`; `/events/[id]` manage page (add items, view items, two copyable links)
- `createEvent` / `addItem` Server Actions and a new `src/lib/lists/owned-events.ts` DAL module
- A new `Combobox` design-system primitive (searchable dropdown) + showcase demo
- Relocating the shared `FormState` type to `src/lib/forms/` (per an explicit forward-note left in F-02)
- pgTAP coverage for three previously-untested item length constraints

**Out of scope:**
- Item editing/deletion (S-04), events dashboard (parked), share-link revocation (open roadmap question)
- Any new RLS policy or RPC — the write paths already exist. (One narrow migration *is* now in scope — see Key Decisions — but it changes no RLS, grant, or runtime behavior, only a generated-type mismatch.)
- Optimistic UI, live character counters, a third-party combobox/UI library
- Component-testing infrastructure — the new `Combobox` and forms are verified manually

## Architecture / Approach

Same shape as the F-01 auth slice and the F-02 `shared-list.ts` module: a `server-only` DAL per domain area, thin Server Actions that zod-parse `FormData` and call the DAL, client components built from existing primitives (plus the new `Combobox`) with `useActionState`. The organizer's own reads/writes go straight to `public.events`/`public.items` under RLS — no RPC layer, unlike the guest/claim path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Migration + data layer | A new migration fixing the events Insert-type mismatch, `FormState` relocation, zod schemas, `owned-events.ts` DAL, unit tests | The generated Insert type's required-but-ungranted trigger columns — fixed at the root with harmless DB defaults (plan-review decision) rather than the cast originally planned |
| 2. Combobox primitive | A new searchable-dropdown design-system component + showcase demo | Getting the ARIA combobox contract right with no prior art in this codebase |
| 3. Create-event flow | `/` branches on session to show the form; Server Action | Doubling the per-request auth round trip if `getUser()` is used instead of `getClaims()` |
| 4. Manage page | `/events/[id]` page, add-item form, item list, two copyable links | Correctly distinguishing "not found" from "load error" (three-outcome result, not two) |
| 5. DB coverage + doc hygiene | pgTAP cases for item length constraints, stale-comment cleanup in `routes.ts` | None significant |

**Prerequisites:** local Supabase stack running for `pnpm test:db` (`colima start`, `supabase start`); F-01 and F-02 already shipped (both done/impl-reviewed).
**Estimated effort:** ~2-3 sessions across 5 phases; Phase 4 is the largest, Phase 2 the riskiest to get right on the first pass.

## Open Risks & Assumptions

- The guest share link points to `/lists/<share_token>`, which doesn't resolve until S-02 (`browse-shared-list`) ships — accepted, since S-02 is next on the roadmap stream.
- `Intl.supportedValuesOf("timeZone")` isn't universal on older browsers; the Combobox override is hidden when unavailable, falling back to auto-detect only.
- The organizer link is a plain protected URL, not a secret token — anyone who gets hold of it still needs to be signed in as the owner to see anything, since RLS (not the URL's obscurity) is what actually protects it.
- A 23514 (check-constraint) violation that somehow bypasses the mirrored zod validation falls through `mapRpcError` to a generic "unknown" message — acceptable, matches the existing auth Server Action's "everything else is generic" copy policy.

## Success Criteria (Summary)

- An organizer can create an event, add items, and get both a working guest share link and a working link back to their own manage page, without ever hitting a raw Postgres error message.
- Nobody but the owning organizer can view or add items to `/events/<id>` — verified the same way F-02 verifies owner isolation.
- The new Combobox is fully keyboard-operable and visually consistent with the rest of the design system.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, and `pnpm test:integration` all pass.
