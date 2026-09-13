# Claim Gift Item — Plan Brief

> Full plan: `context/changes/claim-gift-item/plan.md`

## What & Why

GIN's north-star flow (roadmap S-03): a signed-in guest claims one unclaimed item from a shared list, it flips to "taken" for everyone else, and the organizer stays completely blind to claim status until the post-event reveal. This is the smallest slice that proves GIN's core hypothesis — coordinated, non-duplicate, organizer-blind claiming.

## Starting Point

The hard part is already done. F-02 (`surprise-rule-data-contract`) built and tested the atomic single-claim constraint, the `claim_item` RPC (auth → item-exists → owner-exclusion → reveal-gate → insert), RLS, and a DAL wrapper (`claimItem` in `src/lib/lists/shared-list.ts`) — but that wrapper has zero call sites and zero tests. S-02 (`browse-shared-list`) built the read-only shared-list page with `StatusBadge` but explicitly scoped claiming out. Nothing on the UI or Server Action layer exists yet.

## Desired End State

A guest clicks "Claim," confirms in a modal, and sees the item flip to "Claimed by you" with a success toast within about a second. A guest who loses a claim race gets a clear message and an auto-updated badge. A guest with a lapsed session is redirected to sign in and returned to the list. An organizer who encounters their own unclaimed item after the reveal opens gets a graceful rejection, not a crash or a leak.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Live updates for idle viewers | Rely on next page load/refresh, no push | No new infra for a guarantee that's already race-safe server-side regardless of what stale UI shows |
| Claiming guest's UI feedback | Pending state, flip only after server confirms | Matches the existing `Button pending` pattern from `edit-list-items`; no new optimistic-state machinery |
| Confirm before claiming | Modal confirmation required | Claiming is irreversible in v1 (unclaim is parked) — user chose the extra safety step |
| Race-loser (`already_taken`) UX | Toast + auto-refresh flips badge to "taken" | Matches CLAUDE.md's rule that a toast must supplement an inline state change |
| Claims-closed mid-session | Same toast + refresh treatment as race-loser | Reuses one error-handling path instead of a dedicated view for a rare timing edge case |
| Stale/expired session | Toast + redirect to `/login?next=/lists/[token]` | Reuses the exact `?next=` pattern already proven by `VisibilityBanner` and the auth actions |
| Testing scope | DAL + Server Action unit tests, manual UI verification | Matches repo convention (no RTL/jsdom anywhere); the race guarantee is already locked by F-02's pgTAP + integration suites |
| Priority if time is tight | No fallback — everything decided here ships together | User's explicit call; no partial-completion state for this slice |

## Scope

**In scope:**
- Server Action wrapping the existing `claimItem` DAL call
- Claim button + modal confirmation UI on the shared-list page
- Full error-code UX: race-loser, claims-closed, owner-cannot-claim (post-reveal edge case), stale session
- Unit tests for the previously-untested `claimItem` DAL function and the new Server Action
- Regression verification of F-02's pgTAP + integration suites

**Out of scope:**
- Unclaim (FR-012), second-claim warning (FR-013), event dashboard (FR-014) — all parked
- Mark-as-given / post-event reveal UI — that's `post-event-reveal` (S-05)
- Any schema, RLS, or RPC changes — F-02's contract is reused as-is
- Live/realtime push updates or optimistic client-side state

## Architecture / Approach

Reuse `EditItemModal`'s exact pattern (`Modal` + `useActionState` + a per-item-bound Server Action), since `claimItem` needs no form fields — only the field-parsing step is dropped. A new `ClaimButton` client component renders inside the still-server-rendered `SharedItemList`, only for `status === "available"` items, keeping the client boundary as small as possible (unlike S-04, which needed the whole list promoted to `"use client"` for shared state this feature doesn't need).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server Action + Test Coverage | `claimItemAction` wrapping the DAL call, unit tests for both | First Server Action in the codebase with direct unit tests — no existing precedent to copy exactly |
| 2. Claim UI | Modal-confirmed Claim button wired into the shared list, full error-code UX | The organizer-can-see-"available"-after-reveal edge case must be handled, not just the guest happy path |
| 3. Regression & Edge-Case Verification | Confirms no regression to F-02's guardrails; manual race/latency/stale-session walkthroughs | None expected — this phase should find nothing, by design |

**Prerequisites:** S-02 (browse-shared-list, done), F-01 (auth, done), F-02 (surprise-rule-data-contract, functionally complete though not yet archived)
**Estimated effort:** ~1 session across 3 phases — the backend is already built; this is UI wiring plus verification

## Open Risks & Assumptions

- F-02's change folder hasn't gone through `/10x-archive` yet despite being functionally complete (all plan checkboxes checked) — this plan treats it as done and depends on its RPCs; if it turns out incomplete, Phase 1 will surface that immediately via the DAL unit tests.
- The organizer-post-reveal "available" edge case (Critical Implementation Details in the full plan) was discovered during planning, not flagged in the roadmap's original "Unknowns" — worth a second look during implementation to confirm the RPC's check order still holds as described.

## Success Criteria (Summary)

- A signed-in guest can claim an available item and see it confirmed within ~1s, persisted across reload
- A race loser sees a clear message and an auto-corrected badge, no manual reload needed
- The organizer's pre-reveal blindness guarantee and the duplicate-claim guardrail show zero regression after this slice ships
