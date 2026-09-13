<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit List Items

- **Plan**: context/changes/edit-list-items/plan.md
- **Scope**: Full plan (Phases 1–5, all complete)
- **Date**: 2026-09-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria evidence

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `pnpm test` — 88/88 pass (8 files)
- `pnpm test:db` — 118/118 pass (5 files), including the new Phase 5 stranger-update-denied case
- All `## Progress` manual checkboxes are `[x]` with matching implemented functionality found in the diff (no rubber-stamping observed)

## Findings

### F1 — `Modal`'s "single `onClose` call site" contract isn't honored by its consumers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture / Plan Adherence
- **Location**: src/components/modal/modal.tsx:12-15 (comment); src/app/events/[id]/components/edit-item-modal/edit-item-modal.tsx:94 (Cancel `onClick`); src/app/design-system/components/modal-demo/modal-demo.tsx:24 (Close `onClick`)
- **Detail**: The plan's "Critical Implementation Details" section requires routing every close path (Cancel button, backdrop click, Escape) through `dialogRef.current.close()` so the native `close` event is the *only* place that invokes `onClose`. `modal.tsx`'s own header comment asserts this ("callers never call `onClose` directly"). In practice, both real consumers wire their Cancel/Close button straight to `onClose()` instead. This makes `onClose` fire twice per cancel: once directly from the click handler, and again when the sync effect notices `open` flipped to `false` and calls `dialog.close()` on the still-native-open dialog, re-firing the native `close` event. It's invisible today because both `onClose` implementations are idempotent state setters (`setEditingItemId(null)`, `setOpen(false)`), but the invariant the plan and the code comment both promise is not actually enforced, and a future consumer with a non-idempotent `onClose` (an analytics call, a one-shot toast) would silently double-fire. Independently flagged by both review sub-agents.
- **Fix A ⭐ Recommended**: Correct the comment in `modal.tsx` to describe the real contract (`onClose` may be invoked either via the native `close` event or directly by a consumer's close button, so it must be idempotent) rather than promising a single call site that isn't enforced.
  - Strength: Zero behavior risk, a two-line change, makes the documentation honest.
  - Tradeoff: Doesn't close the actual gap — a future non-idempotent `onClose` would still double-fire.
  - Confidence: HIGH — trivial, no behavior change.
  - Blind spot: None significant.
- **Fix B**: Make `Modal` enforce the invariant for real — expose an imperative close path (e.g. `forwardRef` exposing the dialog, or an `onRequestClose` render-prop) so both Cancel buttons trigger `dialogRef.current.close()` instead of calling `onClose` directly, guaranteeing exactly one path into `onClose`.
  - Strength: Matches the plan's literal contract; removes the double-fire class entirely for any future consumer.
  - Tradeoff: Widens `Modal`'s API surface for a currently-cosmetic bug; touches the primitive plus both consumer call sites.
  - Confidence: MEDIUM — no existing precedent in this design system for a `forwardRef` primitive (`Combobox` doesn't expose one either).
  - Blind spot: Haven't checked whether a future modal consumer would need direct dialog access anyway, which would make this refactor pay for itself sooner.
- **Decision**: FIXED via Fix A — comment in modal.tsx corrected to describe the real contract and require idempotent `onClose`.

### F2 — `item-list.tsx` bypasses its own component barrel

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/app/events/[id]/components/item-list/item-list.tsx:8
- **Detail**: Imports `EditItemModal` via the sibling-relative path `"../edit-item-modal/edit-item-modal"` instead of the local barrel (`src/app/events/[id]/components/index.ts`), which already re-exports it. This is the only relative cross-component import of its kind in `src/app` — CLAUDE.md's barrel convention says consumers import from the components directory itself.
- **Fix**: Change the import to `import { EditItemModal } from "..";` (the local `components` barrel).
- **Decision**: FIXED — import switched to the local barrel; verified with `pnpm typecheck`, `pnpm lint`, and `pnpm build` (the resulting circular import — the barrel re-exports `ItemList` from `item-list.tsx`, which now imports back from the barrel — resolves cleanly since all exports are function declarations, not eagerly-evaluated bindings).

### F3 — `revealOpen` re-derives `reveal_open`'s SQL formula in JS

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/lists/owned-events.ts:150-154
- **Detail**: `getOwnedEvent` computes `revealOpen` client-side using the same formula as `private.reveal_open` in SQL, which duplicates a business-rule formula CLAUDE.md says must live solely at the data layer. This is materially different from the "never a parallel app-side filter" case CLAUDE.md warns about: no claim data is read here (`getOwnedEvent`'s items query never selects claim columns regardless of reveal state), and the actual write is independently enforced by `items_update_owner`'s RLS `WITH CHECK`, backstopped by a pgTAP test — this JS value only gates the Edit *button's* visibility. The plan.md's "Key Discoveries" section explicitly already made this tradeoff, calling it a UX improvement over a bare DB error rather than a new invariant. The residual risk is silent drift: if `reveal_open`'s SQL formula changes, this mirror goes stale with no test to catch it (worst case is a cosmetic Edit-button mismatch, not a claim-data leak).
- **Fix**: Add a test (unit or pgTAP) asserting the two formulas produce the same result for the same inputs, so a future change to `private.reveal_open` forces a corresponding review of this function.
- **Decision**: FIXED — comment now cross-references the exact migration file/line for `private.reveal_open`'s definition and calls out the cosmetic-only nature of drift; added a boundary unit test (`owned-events.test.ts`, "revealOpen is true when auto_reveal_at exactly equals now") pinning the SQL's inclusive `now() >= e.auto_reveal_at` against the JS `Date.now() >= ...getTime()`. 89/89 unit tests pass.

### F4 — `AddItemForm` has no reveal-state gating (pre-existing, adjacent to this diff)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline (out of scope for this slice)
- **Location**: src/app/events/[id]/page.tsx:82
- **Detail**: Phase 4 hides the Edit button once the reveal has opened, but `AddItemForm` — subject to the identical `items_insert_owner` RLS reveal check — is still rendered unconditionally. Adding an item post-reveal will fail with a raw generic DB error rather than being hidden like Edit now is. Not introduced by this change (`AddItemForm` is unmodified) and not in `edit-list-items`' stated scope, but worth a follow-up now that the "hide instead of error" pattern has been established.
- **Fix**: Track as a follow-up for a future slice (e.g. alongside S-05) rather than fixing in this review.
- **Decision**: FIXED — `page.tsx` now renders `AddItemForm` conditionally (`{!event.revealOpen && <AddItemForm eventId={event.id} />}`), matching the "hide instead of error" pattern Phase 4 established for Edit. Verified with `pnpm typecheck`, `pnpm lint`, `pnpm test` (89/89), and `pnpm build`.
