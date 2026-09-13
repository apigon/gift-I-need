---
project: "GIN (Gift I Need)"
version: 1
status: draft
created: 2026-07-09
updated: 2026-09-13
prd_version: 1
main_goal: speed
top_blocker: capacity
---

# Roadmap: GIN (Gift I Need)

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

GIN decouples a gift list from any retailer: an organizer curates gift ideas, shares one link, and guests coordinate claims among themselves — without the organizer seeing who claimed what until the event date passes. The load-bearing mechanic is a time-gated information asymmetry (guests see "taken"/"available" in real time; the organizer is blind until the date), enforced by the product rather than by social convention. v1 covers the two flows that prove this: organizer creates/shares a list, and guests claim items with a post-event reveal.

## North star

**S-03: guest signs in and claims an unclaimed item** — this is the validation milestone, the smallest end-to-end flow whose successful delivery proves GIN's core hypothesis (coordinated, non-duplicate, organizer-blind claiming); everything else only matters if this works, so it is placed as early as its prerequisites allow.

> "North star" here means exactly that: the smallest user-visible slice that, once shipped, demonstrates the product's core promise. It sits behind the create/share and browse slices only because a guest needs a shared list to claim from — not because it is deprioritized.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                            | Prerequisites    | PRD refs               | Status   |
| ---- | -------------------------- | --------------------------------------------------------------- | ---------------- | ---------------------- | -------- |
| F-01 | email-password-auth        | (foundation) email/password sign-up, sign-in, sign-out wired    | —                | FR-001, FR-002         | done     |
| F-02 | surprise-rule-data-contract| (foundation) schema + enforced organizer-blindness & single-claim | —              | NFR (both), FR-011     | in-progress |
| F-03 | design-system-baseline     | (foundation) shared design tokens + base theme (incl. available/taken status styles) | — | FR-007, FR-009, NFR (confirmation) | done |
| S-01 | create-and-share-event-list| create an event, add gift ideas, and share a link               | F-01, F-02, F-03 | US-01, FR-003, FR-004, FR-006 | done |
| S-02 | browse-shared-list         | browse a shared list unauthenticated and see available/taken    | S-01, F-02       | US-01, FR-007, FR-009  | done |
| S-03 | claim-gift-item            | sign in and claim an unclaimed item; it flips to "taken"        | S-02, F-01, F-02 | US-01, FR-008, FR-009  | done |
| S-04 | edit-list-items            | edit items on their own event list                              | S-01, F-01       | FR-005                 | done |
| S-05 | post-event-reveal          | after the event date, see full claim status and mark items given | S-03, F-01, F-02 | US-02, FR-010, FR-011  | planning |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme            | Chain                              | Note                                                                    |
| ------ | ---------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| A      | Account access   | `F-01`                             | Standalone auth foundation; unlocks every authenticated write (S-01/03/04/05). Parallel with Stream B. |
| B      | Core claim loop  | `F-02` → `S-01` → `S-02` → `S-03`  | The north-star path (S-03). S-01 also needs `F-01` from Stream A.        |
| C      | List curation    | `S-04`                             | Parallel branch off `S-01`; independent of the claim path — a capacity lever. |
| D      | Post-event reveal| `S-05`                             | Joins Stream B at `S-03`; exercises the reveal side of the surprise rule. |
| E      | Design system    | `F-03`                             | Standalone foundation; underpins the UI of every slice (S-01–S-05). Land before parallel UI work to prevent visual drift. |

## Baseline

What's already in place in the codebase as of `2026-07-09` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Next.js 16 App Router + React 19 + Tailwind v4; only a placeholder homepage (`src/app/page.tsx`). No feature UI yet. Tailwind is wired but there are no shared design tokens / theme layer (available/taken status styles, typography scale) — see F-03.
- **Backend / API:** present — Server Action / API-route pattern established; only `src/app/api/health/route.ts` exists. No feature logic yet.
- **Data:** absent — Supabase project linked (`supabase/.temp/`), but no schema, no migrations directory, no tables. Core gap.
- **Auth:** partial — Supabase SSR clients wired (`src/utils/supabase/{client,server,proxy}.ts`), middleware refreshes the session, health route calls `getUser()`. No sign-up/sign-in UI and no auth Server Actions.
- **Deploy / infra:** present — Cloudflare Workers via OpenNext (`wrangler.jsonc`, `open-next.config.ts`, deploy scripts). CI/deploy runs through Cloudflare's Git integration (auto-deploy on push to `master`, PR previews) — no GitHub Actions needed.
- **Observability:** partial — `wrangler.jsonc` observability block enabled (Workers logs + `wrangler tail`). No error tracking or app-level logging.
- **Testing (note):** no test runner configured (no vitest/jest/playwright). Called out in CLAUDE.md and the infra risk register as required before claim-status logic ships — addressed in F-02.

## Foundations

### F-01: Email/password authentication

- **Outcome:** (foundation) email/password sign-up, sign-in, and sign-out are wired to the existing Supabase SSR scaffold; an authenticated session is available to Server Actions and Server Components.
- **Change ID:** email-password-auth
- **PRD refs:** FR-001, FR-002, Access Control (email + password only)
- **Unlocks:** S-01 (creating an event is an authenticated write), S-03 (claiming requires sign-in), S-04 (editing requires auth), S-05 (marking given requires auth).
- **Prerequisites:** — (Supabase SSR clients + session middleware already present per Baseline)
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Scaffold exists (clients, middleware), so this is the user-facing sign-up/sign-in surface + Server Actions, not a from-scratch auth build; the load-bearing verification is that the cookie/session path holds under `workerd` (the health route already smoke-tests it). Kept minimal — no OAuth, no dashboard (both parked).
- **Status:** done

### F-02: Data schema + surprise-rule data contract

- **Outcome:** (foundation) the minimal schema for events, items, and claims exists, with row-level policies that enforce organizer-blindness (a query-level event-date gate) and a database constraint that makes a single claim per item atomic; a test runner plus one test lock both guarantees.
- **Change ID:** surprise-rule-data-contract
- **PRD refs:** NFR (organizer never sees claim status before the event date; holds under concurrent updates / refresh / direct URL), NFR (claim confirmed within 1s), FR-011 (hard visibility gate), Guardrails (no two guests claim the same item), Business Logic
- **Unlocks:** S-01 (events/items tables), S-02 (read available/taken), S-03 (atomic claim + blindness), S-05 (date-gated reveal); reduces the "RLS leak via service-role bypass" and "no test runner → correctness regressions ship uncaught" risks from the infra risk register; provides the verification path S-03 and S-05 depend on.
- **Prerequisites:** — (RLS policies reference Supabase `auth.uid()`, available independent of F-01's UI)
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - ~~Should the date gate be enforced purely in RLS, purely in query filters, or both (defense in depth)?~~ Resolved in `/10x-plan`: RLS plus `private.reveal_open`; no parallel app-side filter.
- **Risk:** This is the riskiest correctness surface in the product and the one place `speed` does not relax the bar — the surprise rule and duplicate-prevention are must-hold guarantees. Kept to a minimal enabler contract (only the entities the first slices need + the two invariants + a focused test), NOT a full data-layer build: every downstream slice still integrates and exercises these tables through a real user capability.
- **Status:** in-progress

### F-03: Design tokens + base theme

- **Outcome:** (foundation) a shared visual layer over the existing Tailwind v4 setup — design tokens (color, typography scale, spacing) and a base theme that includes the load-bearing "available" vs "taken" status styles and a consistent claim-confirmation feedback state; every feature UI consumes it instead of inventing its own.
- **Change ID:** design-system-baseline
- **PRD refs:** FR-007 (unauthenticated browse surface), FR-009 (items shown as "taken"/"available" — a visual status distinction), NFR (claim confirmation is visible within 1s with no ambiguous pending state — needs a consistent feedback style)
- **Unlocks:** S-01, S-02, S-03, S-04, S-05 — every user-facing slice renders UI against this token/theme layer; establishing it once gives parallel slice builds a shared visual contract so they don't diverge.
- **Prerequisites:** — (Tailwind v4 present per Baseline; this adds the token/theme layer on top, no new framework)
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Off the north-star critical path and cuts against the `speed` bias if over-built, so kept deliberately minimal — tokens + base theme + status/feedback styles, NOT a component library or full design system (that stays folded into each slice's own UI work). Its real justification is `capacity`: when S-01–S-05 UIs fan out to separate agent runs, a shared visual contract prevents the drift that ad-hoc per-slice styling would cause. If it starts to grow into a component catalogue, split it back into the consuming slices.
- **Status:** done

## Slices

### S-01: Organizer creates an event, adds gift ideas, and shares a link

- **Outcome:** an authenticated organizer can create an event (name + date), add gift ideas (title; optional notes, link, price range), and get a shareable link.
- **Change ID:** create-and-share-event-list
- **PRD refs:** US-01 (sets up the shared list), FR-003, FR-004, FR-006
- **Prerequisites:** F-01 (all writes require auth), F-02 (events/items schema), F-03 (renders the create/list UI against the shared theme)
- **Parallel with:** — (heads the core claim loop)
- **Blockers:** —
- **Unknowns:**
  - Can a shared link be revoked/invalidated after sharing? — Owner: user. Block: no (links may be permanent for v1; see Open Roadmap Questions).
- **Risk:** First slice to exercise the F-02 schema end-to-end; the event date captured here is the input the entire surprise rule keys off, so the create form must make the date unambiguous. Item deletion is out of scope (edit-only per Non-Goals).
- **Status:** done

### S-02: Guest browses a shared list and sees available/taken status

- **Outcome:** an unauthenticated visitor can open a shared link and view all items; seeing each item's "available" or "taken" status requires signing in (F-02, amended PRD US-01 AC1). The list is read via `getSharedList` (`src/lib/lists/shared-list.ts`) — no other query path.
- **Change ID:** browse-shared-list
- **PRD refs:** US-01 (browse step), FR-007, FR-009
- **Prerequisites:** S-01 (a created + shared list to browse), F-02 (read the item/claim state)
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Read-only, but the surprise rule still governs status: a signed-out visitor and the (possibly signed-out) organizer both get `status: null` from the RPC, so this view must show "taken" without leaking claimer identity (FR-009), and it must call `getSharedList` rather than any organizer-scoped query path. No claimer name to any guest.
- **Status:** done

### S-03: Guest signs in and claims an unclaimed item

- **Outcome:** a signed-in guest can claim one unclaimed item; the item immediately flips to "taken" for all other guests, and the organizer sees no claim status until the event date.
- **Change ID:** claim-gift-item
- **PRD refs:** US-01, FR-008, FR-009
- **Prerequisites:** S-02 (browse the list to pick an item), F-01 (claim requires sign-in), F-02 (atomic single-claim constraint + organizer-blindness policy)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~What does a guest see when they attempt to claim an item another guest just took (race loser UX)?~~ Resolved in `/10x-plan`: toast error + `refresh()`-driven badge flip to "taken", the same treatment given to the `claims_closed` mid-session edge case.
- **Risk:** The north star and the highest-stakes slice: duplicate-prevention must be reliable under concurrent claims (rests on the F-02 DB constraint, not UI checks), the claim must confirm within ~1s (NFR), and claiming is irreversible in v1 (unclaim is parked, and the user chose a modal confirmation step as an extra safeguard). If F-02's invariants are sound, this slice is mostly wiring the action + a pending-state (non-optimistic) UI.
- **Status:** done

### S-04: Organizer edits items on their own list

- **Outcome:** an authenticated organizer can edit items on an event they created (e.g. rename, update notes/link/price).
- **Change ID:** edit-list-items
- **PRD refs:** FR-005
- **Prerequisites:** S-01 (items must exist to edit), F-01 (edit is an authenticated write)
- **Parallel with:** S-02, S-03 (editing is independent of the claim path — neither blocks the other)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Off the north-star critical path, so sequenced after the core loop under the `speed` bias — but it is the strongest parallel-with candidate, so it is the natural slice to fan out to a separate agent run when capacity is the blocker. Edit-only; deletion is a Non-Goal.
- **Status:** done

### S-05: Post-event reveal and delivery confirmation

- **Outcome:** after the reveal opens — automatically at 00:00 on `event_date + 2` in the event's timezone, or earlier if the organizer unlocks manually from `event_date + 1` — the organizer can see the full claim status (never claimer identity), and either the claiming guest or the organizer can mark an item as "given": a single irreversible mark set by whichever party acts first.
- **Change ID:** post-event-reveal
- **PRD refs:** US-02, FR-010, FR-011
- **Prerequisites:** S-03 (claims must exist to reveal), F-01 (marking given requires auth), F-02 (date-gated visibility policy)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - What is the event lifecycle after the reveal — can the organizer archive/delete the event? — Owner: user. Block: no (see Open Roadmap Questions).
- **Risk:** Exercises the reveal side of the surprise rule via the `unlock_event` / `get_shared_*` RPCs (F-02): the gate must flip exactly at the computed reveal instant and never before, under refresh/direct-URL access (NFR), and the organizer must never see claimer identity even after the reveal. "Given" is a single mark, not independent per-party state, so the UI must treat a second mark-given call as a no-op rather than a second confirmation. This is the second half of the F-02 contract made user-visible.
- **Status:** planning

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                   |
| ---------- | --------------------------- | ------------------------------------------------------------ | --------------------- | --------------------------------------- |
| F-01       | email-password-auth         | Wire email/password sign-up, sign-in, sign-out               | yes                   | Run `/10x-plan email-password-auth`     |
| F-02       | surprise-rule-data-contract | Schema + enforce organizer-blindness & single-claim, with tests | yes                | Run `/10x-plan surprise-rule-data-contract`; unblocks the whole graph |
| F-03       | design-system-baseline      | Design tokens + base theme (available/taken status styles)   | yes                   | Run `/10x-plan design-system-baseline`  |
| S-01       | create-and-share-event-list | Organizer creates an event, adds items, shares a link        | no                    | After F-01 + F-02 + F-03                |
| S-02       | browse-shared-list          | Guest browses a shared list; available/taken status          | no                    | After S-01                              |
| S-03       | claim-gift-item             | Guest claims an unclaimed item (north star)                  | no                    | After S-02 + F-01 + F-02                |
| S-04       | edit-list-items             | Organizer edits items on their list                          | no                    | After S-01 + F-01; parallel with claim path |
| S-05       | post-event-reveal           | Post-event reveal + mark-as-given                           | no                    | After S-03                              |

## Open Roadmap Questions

1. **What is the event lifecycle after post-event confirmation?** Can the organizer delete or archive an event once the reveal has been seen? — Owner: user. Block: `S-05` (affects its final state model and data-retention expectations, but does not block planning — decide during implementation).
2. **Can a shared list link be revoked/invalidated?** FR-006 covers generating a link but not invalidating one shared by mistake. — Owner: user. Block: `S-01` (security-adjacent; links may be permanent for v1, worth an explicit call before launch).

## Parked

- **FR-012 — Guest can unclaim their own item.** Why parked: PRD nice-to-have; claiming is irreversible in v1 (organizer edit is the workaround), and unclaim introduces a coordination race under `speed`.
- **FR-013 — Warn on claiming a second item in the same event.** Why parked: PRD nice-to-have; soft warning, not on the must-have path.
- **FR-014 — Dashboard of events organized/attended.** Why parked: PRD nice-to-have; shared-link re-entry is sufficient for v1.
- **OAuth login (Google/Apple).** Why parked: PRD Non-Goals — email + password only for v1; OAuth is a v2 enhancement.
- **Automatic gift suggestions / AI.** Why parked: PRD Non-Goals — all list content is manually curated.
- **Online gift search / product-catalogue integration.** Why parked: PRD Non-Goals — the link field is optional free text, not product discovery.
- **Social graph / user connections.** Why parked: PRD Non-Goals — lists are shared by link only.
- **Collaborative list editing.** Why parked: PRD Non-Goals — only the creating organizer can add/edit items.
- **Item deletion.** Why parked: PRD Non-Goals — edit-only in v1; deletion is v2.
- **Personal idea-capture for others (Flow 3).** Why parked: PRD Non-Goals — the event-coordination mechanic must prove value first.

## Done

(Empty on first generation. `/10x-archive` appends here — and flips the item's `Status` to `done` — when a change whose `Change ID` matches an item is archived.)

- **F-01: (foundation) email/password sign-up, sign-in, sign-out wired** — Archived 2026-09-11 → `context/archive/2026-09-07-email-password-auth/`. Lesson: —.
- **F-03: (foundation) a shared visual layer over the existing Tailwind v4 setup — design tokens (color, typography scale, spacing) and a base theme that includes the load-bearing "available" vs "taken" status styles and a consistent claim-confirmation feedback state; every feature UI consumes it instead of inventing its own.** — Archived 2026-09-11 → `context/archive/2026-09-10-design-system-baseline/`. Lesson: —.
- **S-01: an authenticated organizer can create an event (name + date), add gift ideas (title; optional notes, link, price range), and get a shareable link.** — Archived 2026-09-12 → `context/archive/2026-09-12-create-and-share-event-list/`. Lesson: —.
- **S-02: an unauthenticated visitor can open a shared link and view all items; seeing each item's "available" or "taken" status requires signing in (F-02, amended PRD US-01 AC1). The list is read via `getSharedList` (`src/lib/lists/shared-list.ts`) — no other query path.** — Archived 2026-09-13 → `context/archive/2026-09-12-browse-shared-list/`. Lesson: —.
- **S-04: an authenticated organizer can edit items on an event they created (e.g. rename, update notes/link/price).** — Archived 2026-09-13 → `context/archive/2026-09-12-edit-list-items/`. Lesson: —.
- **S-03: a signed-in guest can claim one unclaimed item; the item immediately flips to "taken" for all other guests, and the organizer sees no claim status until the event date.** — Archived 2026-09-13 → `context/archive/2026-09-13-claim-gift-item/`. Lesson: —.
