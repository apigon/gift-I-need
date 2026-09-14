<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Organizer-Blindness & Claim-Integrity Guard

- **Plan**: context/changes/testing-organizer-blindness-claim-integrity/plan.md
- **Scope**: Full plan (Phases 1–5)
- **Date**: 2026-09-14
- **Commit range**: a7c959d..210d690 (6 commits: p1–p5 + epilogue)
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria (automated, verified live)

- `pnpm test` — 125 passed (12 files)
- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors, 6 pre-existing unused-param warnings in `lists.ts` (unrelated to this change)
- `pnpm test:integration` — 2 passed (real local stack)
- `pnpm test:db` — 123 assertions passed (Files=5)

All manual Progress items (1.4, 2.4, 3.4, 5.1) were confirmed by the human before being checked off during implementation; Phase 4 has no manual item per the plan.

## Findings

### F1 — Phase 2 integration test needed sign-in helpers the plan's contract didn't anticipate

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is a doc-only update
- **Dimension**: Plan Adherence
- **Location**: src/lib/lists/organizer-view.integration.test.ts; context/foundation/test-plan.md §6.2
- **Detail**: The plan's Phase 2 contract said "no new fixture helpers beyond what `claim-race.integration.test.ts` already established (`signedInClient`/`uniqueEmail`) — reuse them." In practice, `getOrganizerView` transitively depends on Next's `cookies()`/`connection()`, which `claim-race.integration.test.ts`'s plain-client pattern never touched — so the organizer side of the new test needed its own sign-in mechanism (`createServerClient` + cookie jar, `vi.mock` stubs for `next/server`/`next/headers`) beyond `signedInClient`. This is sound, well-commented engineering, not a defect — but §6.2 (written in Phase 5) still describes the integration pattern as "the shared `signedInClient`/`uniqueEmail` helpers," which overstates reuse: `signedInClient` isn't actually exported/shared, and Phase 2 didn't reuse it for the organizer side.
- **Fix**: Add a short note to §6.2 (or a one-line addendum in plan.md) clarifying that a Server-Component-adjacent integration test needs its own cookie-based sign-in helper distinct from the guest-side `signedInClient`, since `signedInClient` isn't actually a shared export today.
- **Decision**: FIXED — added a clarifying note to test-plan.md §6.2 naming `signInOrganizer` and explaining why `signedInClient` doesn't cover the Server-Component-adjacent case.

### F2 — `organizer-view.ts` omits the `server-only` import its sibling DAL modules carry

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/lists/organizer-view.ts:1
- **Detail**: `owned-events.ts` and `shared-list.ts` both start with `import "server-only";`. `organizer-view.ts` is the same kind of module (server-side orchestration, not a pure-function file like `reveal-status.ts`) but omits it. Currently harmless — every path transitively imports a module that already has the guard — but it's a defense-in-depth inconsistency with the module's own stated role.
- **Fix**: Add `import "server-only";` at the top of organizer-view.ts.
- **Decision**: FIXED — added; `pnpm test` (125 passed) and `pnpm typecheck` re-verified clean afterward.

### F3 — `refresh()` guard's log message differs per call site instead of the plan's single literal string

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; no fix needed, documenting only
- **Dimension**: Plan Adherence
- **Location**: src/app/actions/lists.ts (claimItemAction, markGivenAction, unlockEventAction refresh() catch blocks)
- **Detail**: The plan's Phase 3 contract specified one exact literal: `console.error("[actions/lists] refresh() failed after a committed write", error)` at all three sites. The implementation instead logs a distinct, path-identifying message per action (e.g. naming which action failed). This is a positive deviation — better debuggability, same synchronous-guard behavior, no functional gap — confirmed by the safety review that the guard is complete (`refresh()` is fully synchronous per `node_modules/next/dist/server/web/spec-extension/revalidate.js`, so the try/catch covers 100% of its failure surface).
- **Fix**: None — no action needed; noted for the record so the plan's literal-text contract isn't misread as unmet in spirit.
- **Decision**: SKIPPED — positive deviation, left as-is per user.
