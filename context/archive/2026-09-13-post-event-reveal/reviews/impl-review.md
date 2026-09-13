<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Post-Event Reveal

- **Plan**: context/changes/post-event-reveal/plan.md
- **Scope**: Phase 3 of 3 (full plan — all phases complete)
- **Date**: 2026-09-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Automated Verification (re-run)

- `pnpm test` — 116 tests / 11 files passed
- `pnpm typecheck` — clean
- `pnpm lint` — 6 pre-existing `no-unused-vars` warnings on the `_prevState`/`_formData` action-signature params (required by `useActionState`'s contract), 0 errors
- `pnpm build` — production build succeeds

## Findings

### F1 — Mark-given/reveal controls skip the `<form action>` wrapper convention

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/mark-given-button/mark-given-button.tsx`, `src/app/events/[id]/components/reveal-control/reveal-control.tsx`
- **Detail**: Existing `useActionState` client components (`edit-item-modal.tsx:54`, `claim-modal.tsx:56`) wrap the action in `<form action={formAction}>` with a `type="submit"` Button. `MarkGivenButton` and `RevealControl` instead call `formAction(new FormData())` directly from a plain `onClick` on a `type="button"` Button. Functionally equivalent for these single, fieldless actions, but it diverges from the established `useActionState` idiom elsewhere in this codebase.
- **Fix**: Wrap the action call in `<form action={formAction}>` with a `type="submit"` Button, matching `edit-item-modal.tsx`/`claim-modal.tsx`, so all `useActionState` components share one idiom.
- **Decision**: DISMISSED — user's call: for a simple click-only button, wrapping in `<form>` just to fire `formAction` is an antipattern that fights the native `onClick`/button affordance; `edit-item-modal.tsx`/`claim-modal.tsx` need `<form>` because they carry real fields, these two don't. Pattern stays as-is. User separately flagged a broader concern about whether `useActionState`/`FormState` is the right shape at all for fieldless actions (wants something closer to "accept data, return a response status") — noted for a future discussion, not actioned in this review.

### F2 — Planned `unlock-control` shipped as `reveal-control` with different name/copy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/app/events/[id]/components/reveal-control/reveal-control.tsx`, `src/app/events/[id]/components/index.ts`
- **Detail**: Plan specified a new `unlock-control.tsx`/`UnlockControl`, label "Unlock now", `pendingLabel` "Unlocking…", toast "Reveal unlocked". Actual: file/component renamed to `reveal-control.tsx`/`RevealControl` (barrel exports `RevealControl`, not `UnlockControl`), copy is "Open the reveal now" / "Opening…" / "Reveal opened". The gating logic (`event.unlockable && !event.revealOpen`) is unchanged and correctly implemented in `page.tsx`. The file's own header comment documents the rename as a deliberate UX-wording call — "unlock" reads as a permissions action, not what the button does (reveals claim status early) — and aligns wording with the guest-side visibility banner.
- **Fix**: No code change needed — the rename is a reasoned improvement. Add a short addendum to `plan.md` noting the actual file/component name and copy, so future readers and tooling (`/10x-archive`, `/10x-research`) resolve against real code rather than stale plan text.
- **Decision**: FIXED — addendum added to plan.md under Phase 3 item 3. User's rationale: "unlock" would mislead a new organizer into thinking they must click it before sharing the link to let guests claim, rather than it meaning "reveal claim status early."

### F3 — `MarkGivenButton` placed as a shared component, not a local extraction

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture / Scope Discipline
- **Location**: `src/components/mark-given-button/mark-given-button.tsx`
- **Detail**: Plan text suggested extracting the mark-given control locally under `app/lists/[token]/components/shared-item-list/` "if the diff gets noisy." It actually landed in the shared `src/components/` directory instead. Confirmed justified: it's imported from both the guest list (`shared-item-list.tsx`) and the organizer's `item-list.tsx` (Phase 3), matching CLAUDE.md's "shared components sit in `src/components/{name}`" rule.
- **Fix**: None needed — correct call given confirmed dual reuse.
- **Decision**: ACKNOWLEDGED — no action needed.

### F4 — New Server Actions call `refresh()` only on success, unlike `claimItemAction`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/app/actions/lists.ts:69-100`
- **Detail**: `markGivenAction`/`unlockEventAction` call `refresh()` only in their success branch; `claimItemAction` (same file) calls `refresh()` unconditionally, with a comment explaining why. The asymmetry is intentional and correct (a failed mark/unlock genuinely changed nothing — not a bug), but a reader comparing the two actions side by side may wonder about the inconsistency.
- **Fix**: None needed for correctness — optionally add a short comment mirroring `claimItemAction`'s, explaining why `refresh()` is conditional here.
- **Decision**: FIXED — added a clarifying comment to both `markGivenAction` and `unlockEventAction` in `src/app/actions/lists.ts` explaining the conditional `refresh()`. `pnpm typecheck`/`pnpm lint` re-verified clean.

## Notes

- No direct reads/writes of `public.claims` anywhere in `src` — all claim access goes through the `get_shared_*`/`claim_item`/`mark_given`/`unlock_event` RPCs, as required.
- Organizer-blindness holds even under a hypothetical app-side `revealOpen` drift: `private.get_shared_items` independently nulls `status` via `not private.reveal_open(e.id)` in Postgres — the app-side check is an optimization (skip an unnecessary fetch pre-reveal), never the enforcement boundary.
- `mark_given`/`unlock_event` "first caller wins" holds by construction (single atomic `UPDATE ... WHERE ... IS NULL`); the new Server Actions call the RPC once and trust its atomicity rather than doing a read-then-write.
- Design-system compliance (semantic tokens only, `StatusBadge` with visible label, toast-supplements-inline-change) holds across all new/changed components.
- No caching introduced on any list read; `connection()`-gated dynamic rendering preserved.
- `context/foundation/roadmap.md`'s S-05 row/Status still reads `in-progress` despite all three phases being complete — this is expected to flip on `/10x-archive`, not part of this plan's own scope, so it is not raised as a formal finding here.
