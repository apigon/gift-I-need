<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Organizer Creates and Shares an Event List

- **Plan**: context/changes/create-and-share-event-list/plan.md
- **Scope**: All phases (1-5 of 5)
- **Date**: 2026-09-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated verification (re-run during this review)

- `pnpm typecheck` — PASS
- `pnpm lint` — PASS
- `pnpm test` — PASS (83/83)
- `pnpm test:db` — PASS (117 pgTAP assertions across 5 files)
- `pnpm test:integration` — PASS (1/1)

## Summary

16 of 17 planned changes (across all 5 phases) match the plan's stated contract exactly, verified independently against the actual file contents — migration SQL, generated `Insert` type optionality, the `Combobox`'s full ARIA contract, the three-outcome `getOwnedEvent` discrimination, the `addItem` field-clearing effect, the pgTAP savepoint isolation, and the doc/cast cleanups in Phase 5 all match verbatim or in substance. The one deviation (below, F3) is the implementation correctly overriding an inaccurate plan assumption, not drift away from intent.

The hard business rule — the organizer's view must never expose claim status, claimer identity, or claim counts before reveal — holds: `getOwnedEvent` selects no status/claim column, `OwnedEvent`/`OwnedItem` carry no such field, `ItemList` renders no `StatusBadge`, and `public.claims` has zero grants to any API role, so even a full-table read couldn't surface it. Enforcement remains at the data layer (RLS scoped to `owner_id`), not an app-side filter, per CLAUDE.md.

The new migration (`20260912103358_events_insert_defaults.sql`) does only what it says — three column `DEFAULT`s, confirmed against the `database.types.ts` diff (exactly those three fields flip to optional, nothing else touched).

## Findings

### F1 — Post-reveal `addItem` failure surfaces only a generic message

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/app/actions/events.ts (addItem), src/lib/lists/errors.ts:48-50
- **Detail**: Once `revealed_at` is set, `items_insert_owner`'s RLS `with check` closes further item inserts, which Postgres reports as `42501`. `mapRpcError` maps `42501` unconditionally to `"not_authenticated"` (a mapping inherited as-is from the claims domain per the plan's explicit "no new error codes needed" decision). `addItem`'s Server Action doesn't branch on the mapped code at all — any DAL failure returns the generic `"Something went wrong. Please try again."` — so nothing currently shows a wrong or misleading message; the gap is only that a signed-in organizer who tries to add an item after reveal gets no explanation of *why* it failed. Not a success-criterion the plan asked for, and not reachable in practice for at least `event_date + 1` day.
- **Fix**: If this UX gap is worth closing, give `addItem` its own small error-message map (mirroring `EVENT_ERROR_MESSAGES` in the same file) with a specific line for the post-reveal case, rather than relying on the reused `not_authenticated` code, which is semantically about two different things in this codebase now (real auth failures vs. reveal-closed writes).
- **Decision**: SKIPPED — user wants a different, larger fix (disable item-adding once `event_date` has passed, not just after reveal) implemented later, with client-side disablement and the RLS/DB boundary moved to match. This is a deliberate deviation from the current architecture's stated decision (item-adding intentionally stays open until reveal, `event_date+1`/`+2`) and needs its own migration + pgTAP coverage — out of scope for this triage session.

### F2 — `owned-events.ts` header comment overstates the SELECT protection

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/lists/owned-events.ts:12-14
- **Detail**: The module comment says "the column-scoped grants... are what keep this safe," but the column-scoped grants only apply to `INSERT`/`UPDATE` (per the plan's own Current State Analysis). `SELECT` on `events`/`items` is table-wide; the actual reason `getOwnedEvent` can't leak claim data is that `items`/`events` carry no claim-bearing column at all and `public.claims` has zero grants to any API role. A future reader could misread this comment as implying column-scoped `SELECT` grants exist.
- **Fix**: Reword the comment to say RLS (scoped to `owner_id`) plus the absence of any claim column on `events`/`items` is what keeps this safe, not column-scoped grants.
- **Decision**: ACCEPTED-AS-RULE: Column-scoped grants only cover INSERT/UPDATE — don't credit them for SELECT safety (saved to context/foundation/lessons.md; code left unchanged for now, per user)

### F3 — Plan's Phase 4 narrative about default Server Action revalidation was inaccurate; implementation correctly diverged

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Phase 4 overview / §1, §4; src/app/actions/events.ts (addItem)
- **Detail**: The plan states "Next.js's default Server Action revalidation re-renders the page with the new item included" and that this "needs no separate handling." The actual `addItem` implementation explicitly imports and calls `refresh()` from `next/cache`, with a comment noting Server Actions do not auto-revalidate the invoking Server Component in Next.js 16. The implementation is correct (tests and the manual-verification checkbox for "adding an item appends it without a full page navigation" both pass); the plan's stated assumption about framework behavior was simply wrong, consistent with CLAUDE.md's "Next.js 16 is not what you know" warning.
- **Fix**: Optional — add a short addendum to the plan noting the corrected mechanism (`refresh()` from `next/cache`, not default revalidation), so a future reader of the plan doesn't inherit the same wrong assumption.
- **Decision**: FIXED — addendum added to plan.md Phase 4 §1 and §4 correcting the default-revalidation assumption and pointing at `refresh()` in `src/app/actions/events.ts`.
