<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Post-Event Reveal Implementation Plan

- **Plan**: context/changes/post-event-reveal/plan.md
- **Mode**: Deep
- **Date**: 2026-09-13
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 2 observations — all fixed

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS (2 observations) |

## Grounding

17/17 paths ✓, 20/20 symbols ✓, brief↔plan ✓ — every file path, RPC body (`mark_given`, `unlock_event`, `get_shared_items`'s organizer-blindness `CASE`), test citation, and existing UI pattern the plan cites was checked against the actual code and confirmed accurate.

## Findings

### F1 — mark_given/unlock_event concurrency claim misattributed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Testing Strategy → Integration Tests
- **Detail**: The plan justified adding no race test for `mark_given`/`unlock_event` by citing `claim-race.integration.test.ts` as proof the RPC layer is race-safe "end-to-end under concurrency." Verified against the file — it only exercises `claim_item`'s unique-index race; it never calls `mark_given` or `unlock_event`. The no-new-test conclusion was still correct (both RPCs do their write as a single `UPDATE ... WHERE <flag> IS NULL`, atomic via Postgres row-level locking), but the cited evidence was for a different RPC.
- **Fix**: Replaced the citation with the real rationale — atomic single-row `UPDATE` under row-level locking, distinct from `claim_item`'s unique-index race that actually needed multi-connection proof.
- **Decision**: FIXED

### F2 — getSharedList's `not_found` branch unaddressed in the merge

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3.1
- **Detail**: `SharedListResult` has three variants (`ok`/`not_found`/`error`), but Phase 3.1 only named `kind: "error"` as the degrade-to-null case, leaving the implementer to guess about `not_found`.
- **Fix**: Broadened the wording to "any result with `kind !== "ok"` ... degrades gracefully the same way."
- **Decision**: FIXED

### F3 — References omits the migration that grants `unlockable_at`

- **Severity**: 👁️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: References
- **Detail**: Phase 1.1 depends on `events.unlockable_at` being selectable by `authenticated`, a grant that lives in `supabase/migrations/20260911231857_column_scoped_select.sql` — not in the plan's References list.
- **Fix**: Added that migration to References.
- **Decision**: FIXED
