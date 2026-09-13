<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Claim Gift Item Implementation Plan

- **Plan**: context/changes/claim-gift-item/plan.md
- **Scope**: Full plan (Phases 1–3, all complete)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — SharedItemList promoted to a Client Component, reversing the plan's explicit architecture decision

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/app/lists/[token]/components/shared-item-list/shared-item-list.tsx:1,19`; `src/app/lists/[token]/components/claim-button/claim-button.tsx`; `src/app/lists/[token]/components/claim-modal/claim-modal.tsx` (new, unplanned file)
- **Detail**: Phase 2's plan text is explicit: `SharedItemList` "stays a plain Server Component (no `use client` needed at this level — ClaimButton is the client boundary)," contrasted deliberately against S-04's `ItemList`, which needed shared state across items and this feature supposedly didn't.

  The refactor commit `59770fb` ("extract ClaimModal from ClaimButton") reverses that: `ClaimButton` was stripped down to a bare presentational trigger (`claim-button.tsx:5`, just `{ onClick }`), all `useActionState`/`Modal`/toast logic moved to a new `claim-modal.tsx` (never mentioned in the plan), and `SharedItemList` gained `"use client"` (line 1) plus a lifted `claimingItemId` `useState` (line 19) to drive one shared modal instead of one per item — explicitly "mirroring ItemList/EditItemModal" per the commit message, i.e. converging on the exact pattern the plan said this feature didn't need.

  `plan.md` was touched in that same commit, but only to stamp Progress checkboxes with the new commit SHA — the Phase 2 "Changes Required" prose describing `ClaimButton`'s original contract and the "stays a Server Component" line were never updated, so the plan document now misdescribes the shipped architecture.

  Both review sub-agents independently confirmed this introduces **no data leak**: `get_shared_items` already nulls `status` pre-reveal at the RPC layer, so the client bundle never receives claimer identity or counts regardless of which component is a Client Component — the organizer-blindness invariant (CLAUDE.md) holds. The change is a legitimate engineering tradeoff (avoids mounting a `useActionState`+`Modal` instance per available item), not a regression.

- **Fix A ⭐ Recommended**: Update `plan.md`'s Phase 2 section with a short addendum documenting the `ClaimModal` split — the shared-modal-with-lifted-state pattern (mirroring `ItemList`) was adopted instead of the original per-item design, why (avoids N mounted action instances), and that `SharedItemList` is now a Client Component with no invariant impact (status is already redacted server-side).
  - Strength: Preserves the shipped, tested, verified-safe code; brings the plan back in sync with reality for `/10x-archive` and future reviews that treat the plan as ground truth.
  - Tradeoff: A few minutes of documentation work; the plan becomes a slightly moving target rather than a frozen record of original intent.
  - Confidence: HIGH — both sub-agents confirmed no security/architecture regression, and the shipped pattern matches an already-established repo convention (S-04's `ItemList`).
  - Blind spot: The refactor's stated motivation (avoiding N mounted per-item instances) was never load-tested — plausible, not measured.

- **Fix B**: Revert to the original per-item design (`ClaimButton` owns its own `Modal`/`useActionState`) so `SharedItemList` stays a Server Component and the plan needs no correction.
  - Strength: Restores exact plan fidelity and the "keep more of the page on the server" property the plan explicitly wanted.
  - Tradeoff: Discards tested, working code to reintroduce the per-item mounting the refactor deliberately avoided.
  - Confidence: MEDIUM — undoes verified-safe work for a stylistic preference with no demonstrated downside.
  - Blind spot: Haven't checked whether anything else now depends on `ClaimModal` existing as a standalone export.

- **Decision**: FIXED (Fix A) — addendum added to plan.md's Phase 2 §1 and §2 documenting the ClaimModal split and the SharedItemList Client Component change.

### F2 — `claimItem` (and sibling DAL mutations) swallow RPC errors with no logging, now on a live UI-facing failure path

- **Severity**: ⚪ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/lists/shared-list.ts:73-78` (`claimItem`), `:80-89` (`markGiven`)
- **Detail**: `getSharedList` logs (`console.error("[shared-list] get_shared_* failed", rpcError)`) before mapping an RPC error, but `claimItem`/`markGiven` don't — they return the mapped error silently. This function pre-dates this plan (built untested in F-02), but this slice gives it its first real caller (`claimItemAction`), so a genuine claim failure (e.g. an `unknown`-mapped Postgres error) now reaches a real user as a generic toast with zero server-side trace to debug it from.
- **Fix**: Add the same `console.error("[shared-list] claim_item failed", error)` pattern used in `getSharedList` to `claimItem` before returning the mapped error (and optionally to `markGiven` for consistency, though it has no caller yet).
- **Decision**: FIXED — logging added to `claimItem` (`shared-list.ts:73-78`); `markGiven` left as-is (no caller yet, out of this slice's scope). Full suite + typecheck + lint re-verified clean.
